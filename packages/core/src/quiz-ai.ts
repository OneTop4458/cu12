export const DEFAULT_QUIZ_MODEL = "gpt-5.6-luna";
export const QUIZ_MODEL_PRICE_DATE = "2026-09-08";

export const QUIZ_MODEL_OPTIONS = [
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", inputPrice: 0.20, outputPrice: 1.20 },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", inputPrice: 2.00, outputPrice: 12.00 },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", inputPrice: 4.00, outputPrice: 20.00 },
] as const;

export function isQuizModelId(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(model) && !/^sk[-_]/i.test(model);
}

export function quizModelRequestOptions(model: string) {
  return {
    model,
    max_completion_tokens: 4096,
    ...(QUIZ_MODEL_OPTIONS.some((option) => option.id === model) ? { reasoning_effort: "low" as const } : {}),
  };
}
