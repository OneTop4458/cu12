import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
  WEB_INTERNAL_BASE_URL: "https://example.test",
  OPENAI_API_KEY: "test-openai-key",
});

const {
  buildTaskPlan,
  interpretQuizTransition,
  isAutoLearnableTask,
  isTaskPendingInTaskList,
} = await import("../src/cu12-automation");

const baseTask = {
  userId: "user-1",
  lectureSeq: 762,
  weekNo: 6,
  lessonNo: 6,
  taskTitle: "6주차 항목",
  requiredSeconds: 0,
  learnedSeconds: 0,
  state: "PENDING" as const,
  availableFrom: "2026-04-07T00:00:00+09:00",
  dueAt: "2026-04-13T23:59:00+09:00",
};

test("buildTaskPlan includes material and quiz tasks in page order", () => {
  const lectureSeqs = [762];
  const tasksByLecture = new Map([
    [762, [
      { ...baseTask, courseContentsSeq: 26245, activityType: "VOD" as const, requiredSeconds: 1500, learnedSeconds: 1200, taskTitle: "[6.2] 강의" },
      { ...baseTask, courseContentsSeq: 26246, activityType: "MATERIAL" as const, taskTitle: "[6.3] 자료" },
      { ...baseTask, courseContentsSeq: 26247, activityType: "QUIZ" as const, taskTitle: "[6.4] 퀴즈" },
    ]],
  ]);
  const result = buildTaskPlan({
    mode: "SINGLE_ALL",
    lectureSeqs,
    lectureSeq: 762,
    courseTitleBySeq: new Map([[762, "중국문화산책"]]),
    tasksByLecture,
    nowMs: Date.parse("2026-04-08T09:00:00+09:00"),
  });

  assert.equal(result.noOpReason, null);
  assert.deepEqual(
    result.planned.map((item) => ({
      seq: item.task.courseContentsSeq,
      type: item.task.activityType,
    })),
    [
      { seq: 26245, type: "VOD" },
      { seq: 26246, type: "MATERIAL" },
      { seq: 26247, type: "QUIZ" },
    ],
  );
});

test("isAutoLearnableTask accepts pending material and quiz items in window", () => {
  const nowMs = Date.parse("2026-04-08T09:00:00+09:00");
  assert.equal(
    isAutoLearnableTask({ ...baseTask, courseContentsSeq: 1, activityType: "MATERIAL" as const }, nowMs),
    true,
  );
  assert.equal(
    isAutoLearnableTask({ ...baseTask, courseContentsSeq: 2, activityType: "QUIZ" as const }, nowMs),
    true,
  );
});

test("buildTaskPlan returns supported-task no-op reasons when only unsupported tasks remain", () => {
  const result = buildTaskPlan({
    mode: "SINGLE_ALL",
    lectureSeqs: [762],
    lectureSeq: 762,
    courseTitleBySeq: new Map([[762, "중국문화산책"]]),
    tasksByLecture: new Map([
      [762, [{ ...baseTask, courseContentsSeq: 999, activityType: "ASSIGNMENT" as const }]],
    ]),
    nowMs: Date.parse("2026-04-08T09:00:00+09:00"),
  });

  assert.equal(result.noOpReason, "NO_PENDING_SUPPORTED_TASKS");
  assert.equal(result.planned.length, 0);
});

test("isTaskPendingInTaskList detects when a material task disappears from refreshed snapshot", () => {
  const target = { ...baseTask, courseContentsSeq: 26246, activityType: "MATERIAL" as const };
  const refreshed = [
    { ...baseTask, courseContentsSeq: 26247, activityType: "QUIZ" as const },
  ];

  assert.equal(isTaskPendingInTaskList(target, refreshed), false);
});

test("interpretQuizTransition reports retryable and exhausted states", () => {
  assert.equal(
    interpretQuizTransition(
      { questionIndex: 1, questionCount: 2, attemptsUsed: 0, attemptsLimit: 2 },
      { questionIndex: 1, questionCount: 2, attemptsUsed: 1, attemptsLimit: 2 },
      false,
    ),
    "RETRYABLE",
  );
  assert.equal(
    interpretQuizTransition(
      { questionIndex: 1, questionCount: 2, attemptsUsed: 0, attemptsLimit: 1 },
      { questionIndex: 1, questionCount: 2, attemptsUsed: 1, attemptsLimit: 1 },
      false,
    ),
    "EXHAUSTED",
  );
  assert.equal(
    interpretQuizTransition(
      { questionIndex: 1, questionCount: 2, attemptsUsed: 0, attemptsLimit: 1 },
      { questionIndex: 2, questionCount: 2, attemptsUsed: 0, attemptsLimit: 1 },
      false,
    ),
    "ADVANCED",
  );
});
