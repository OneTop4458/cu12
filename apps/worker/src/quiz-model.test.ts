import assert from "node:assert/strict";
import test, { mock, type TestContext } from "node:test";
import { DEFAULT_QUIZ_MODEL, quizModelRequestOptions } from "@cu12/core";
import { prisma } from "./prisma";
import { generateQuizAnswer, type QuizPromptInput } from "./openai";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  APP_MASTER_KEY: "quiz-model-fixture".repeat(3), WORKER_SHARED_TOKEN: "quiz-model-fixture".repeat(3),
  OPENAI_API_KEY: "unit-test-openai-key",
});
const question: QuizPromptInput = {
  courseTitle: "Fixture", weekNo: 1, lessonNo: 1, quizTitle: "Fixture",
  questionIndex: 1, questionCount: 1, questionType: "CHOICE", prompt: "2+2?",
  attemptsUsed: 0, attemptsLimit: 1, options: [{ value: "four", label: "4" }],
};
test.afterEach(() => mock.restoreAll());

function settings(t: TestContext, read: () => Promise<unknown>) {
  const original = prisma.appSettings.findUnique;
  Reflect.set(prisma.appSettings, "findUnique", read);
  t.after(() => Reflect.set(prisma.appSettings, "findUnique", original));
}

test("each quiz request reads the saved model and preserves the JSON answer contract", async (t) => {
  let model: string = DEFAULT_QUIZ_MODEL;
  const requests: Record<string, unknown>[] = [];
  settings(t, async () => ({ quizModel: model }));
  mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ mode: "CHOICE", selectedValues: ["four"], confidence: 1, rationale: "Arithmetic" }) } }] });
  });
  assert.deepEqual((await generateQuizAnswer(question)).selectedValues, ["four"]);
  model = "gpt-5.6-terra";
  await generateQuizAnswer(question);
  assert.deepEqual(requests.map((body) => body.model), [DEFAULT_QUIZ_MODEL, "gpt-5.6-terra"]);
  assert.equal(requests[0].temperature, undefined);
  assert.equal(requests[0].reasoning_effort, "low");
  assert.equal(requests[0].max_completion_tokens, 4096);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
});

test("custom compatible models do not inherit unsupported reasoning parameters", () => {
  assert.deepEqual(quizModelRequestOptions("gpt-4o-mini"), { model: "gpt-4o-mini", max_completion_tokens: 4096 });
});

test("missing settings use Luna and incomplete responses cannot become quiz submissions", async (t) => {
  settings(t, async () => null);
  mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    assert.equal(JSON.parse(String(options?.body)).model, DEFAULT_QUIZ_MODEL);
    return Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  });
  await assert.rejects(generateQuizAnswer(question), /OPENAI_RESPONSE_INCOMPLETE/);
});

test("a settings read failure does not silently charge a different fallback model", async (t) => {
  settings(t, async () => { throw new Error("settings unavailable"); });
  const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("must not call API"); });
  await assert.rejects(generateQuizAnswer(question), /settings unavailable/);
  assert.equal(fetch.mock.callCount(), 0);
});
