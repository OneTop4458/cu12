import { getEnv } from "./env";

export type QuizAnswerMode = "TEXT" | "CHOICE" | "SEQUENCE";

export interface QuizPromptOption {
  value: string;
  label: string;
}

export interface QuizPromptItem {
  key: string;
  label: string;
}

export interface QuizPromptInput {
  courseTitle: string;
  weekNo: number;
  lessonNo: number;
  quizTitle: string;
  questionIndex: number;
  questionCount: number;
  questionType: string;
  prompt: string;
  attemptsUsed: number;
  attemptsLimit: number;
  options?: QuizPromptOption[];
  sourceItems?: QuizPromptItem[];
  answerItems?: QuizPromptItem[];
  priorFailedAnswers?: string[];
  feedbackText?: string | null;
}

export interface QuizAnswerPlan {
  mode: QuizAnswerMode;
  textAnswer?: string;
  selectedValues?: string[];
  sequenceValues?: string[];
  confidence: number;
  rationale: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function trimStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function toPromptPayload(input: QuizPromptInput) {
  return {
    ...input,
    feedbackText: input.feedbackText ?? null,
    options: input.options ?? [],
    sourceItems: input.sourceItems ?? [],
    answerItems: input.answerItems ?? [],
    priorFailedAnswers: input.priorFailedAnswers ?? [],
  };
}

function normalizePlan(raw: unknown): QuizAnswerPlan {
  const fallback: QuizAnswerPlan = {
    mode: "TEXT",
    textAnswer: "",
    confidence: 0,
    rationale: "Empty model response",
  };

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const record = raw as Record<string, unknown>;
  const mode = record.mode === "CHOICE" || record.mode === "SEQUENCE" ? record.mode : "TEXT";
  const textAnswer = typeof record.textAnswer === "string" ? record.textAnswer.trim() : undefined;
  const selectedValues = trimStringArray(record.selectedValues);
  const sequenceValues = trimStringArray(record.sequenceValues);
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? Math.max(0, Math.min(1, record.confidence))
    : 0;
  const rationale = typeof record.rationale === "string" && record.rationale.trim().length > 0
    ? record.rationale.trim()
    : "No rationale provided";

  return {
    mode,
    textAnswer,
    selectedValues,
    sequenceValues,
    confidence,
    rationale,
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    return JSON.parse(match[0]);
  }
}

function buildSystemPrompt(): string {
  return [
    "You answer CU12 quiz questions.",
    "Use the provided course context and your general knowledge when necessary.",
    "Always return one JSON object and nothing else.",
    "For text answers, keep the answer concise and directly usable as a submission.",
    "For choice answers, return the exact option values from the prompt.",
    "For sequence answers, return the exact item keys in source-item order.",
    "Best-guess is required even when confidence is low.",
  ].join(" ");
}

function buildUserPrompt(input: QuizPromptInput): string {
  const payload = JSON.stringify(toPromptPayload(input), null, 2);
  return [
    "Return JSON with this shape:",
    "{\"mode\":\"TEXT|CHOICE|SEQUENCE\",\"textAnswer\":\"\",\"selectedValues\":[],\"sequenceValues\":[],\"confidence\":0.0,\"rationale\":\"\"}",
    "Use TEXT for short-answer/essay/fill-in inputs, CHOICE for single/multi choice, and SEQUENCE for matching/ordering.",
    "If mode is TEXT, fill textAnswer only.",
    "If mode is CHOICE, fill selectedValues with exact option values.",
    "If mode is SEQUENCE, fill sequenceValues with exact answer-item keys aligned to source-item order.",
    "Quiz context:",
    payload,
  ].join("\n");
}

export async function generateQuizAnswer(input: QuizPromptInput): Promise<QuizAnswerPlan> {
  const env = getEnv();
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.trim().length === 0) {
    throw new Error("OPENAI_API_KEY is required for quiz auto-solving.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 400)}`);
    }

    const payload = await response.json() as OpenAiChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject(content);
    return normalizePlan(parsed);
  } finally {
    clearTimeout(timeout);
  }
}
