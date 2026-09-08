import { DEFAULT_QUIZ_MODEL } from "@cu12/core";
import { generateQuizAnswer, type QuizPromptInput } from "./openai";
import { prisma } from "./prisma";

async function main() {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" }, select: { quizModel: true } });
  const base: QuizPromptInput = {
    courseTitle: "Synthetic model compatibility check", quizTitle: "Synthetic check",
    weekNo: 1, lessonNo: 1, questionIndex: 1, questionCount: 1,
    questionType: "CHOICE", prompt: "", attemptsUsed: 0, attemptsLimit: 1,
  };
  const cases = [
    { input: { ...base, prompt: "2 + 2 = ?", options: [{ value: "A", label: "3" }, { value: "B", label: "4" }] },
      check: (answer: Awaited<ReturnType<typeof generateQuizAnswer>>) => answer.mode === "CHOICE" && answer.selectedValues?.join() === "B" },
    { input: { ...base, questionType: "TEXT", prompt: "대한민국의 수도를 한국어 도시명만 답하세요." },
      check: (answer: Awaited<ReturnType<typeof generateQuizAnswer>>) => answer.mode === "TEXT" && Boolean(answer.textAnswer?.includes("서울")) },
    { input: { ...base, questionType: "SEQUENCE", prompt: "Match each fruit to its typical color, in source order.",
      sourceItems: [{ key: "banana", label: "Banana" }, { key: "strawberry", label: "Strawberry" }],
      answerItems: [{ key: "red", label: "Red" }, { key: "yellow", label: "Yellow" }] },
      check: (answer: Awaited<ReturnType<typeof generateQuizAnswer>>) => answer.mode === "SEQUENCE" && answer.sequenceValues?.join() === "yellow,red" },
  ];
  const started = Date.now();
  let passed = 0;
  for (const sample of cases) {
    if (!sample.check(await generateQuizAnswer(sample.input))) throw new Error("MODEL_CHECK_ANSWER_MISMATCH");
    passed += 1;
  }
  console.log(JSON.stringify({ ok: true, model: settings?.quizModel ?? DEFAULT_QUIZ_MODEL, passed, total: cases.length, elapsedMs: Date.now() - started }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/^OpenAI API error (\d{3}):/)?.[1] ?? null;
  const code = message.match(/"(?:code|type)"\s*:\s*"([a-z_]{1,64})"/)?.[1]
    ?? (message.startsWith("MODEL_CHECK_") ? message : "MODEL_CHECK_FAILED");
  // Never echo API error bodies, credentials, questions, or generated answers.
  console.error(JSON.stringify({ ok: false, status, code }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
