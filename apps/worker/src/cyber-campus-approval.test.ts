import assert from "node:assert/strict";
import test from "node:test";
import type { LearningTask } from "@cu12/core";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
});

const {
  buildCyberCampusApprovalNoPendingAutoLearnResult,
  selectCyberCampusApprovalProbeTasks,
  shouldResumeBlockedAutoLearnForApprovalContext,
} = await import("./cyber-campus-approval");

function makeTask(overrides: Partial<LearningTask>): LearningTask {
  return {
    userId: "user-1",
    provider: "CYBER_CAMPUS",
    lectureSeq: 101,
    externalLectureId: "A202600000001",
    courseContentsSeq: 1,
    weekNo: 1,
    lessonNo: 1,
    taskTitle: "1주차 1차시",
    activityType: "VOD",
    requiredSeconds: 1800,
    learnedSeconds: 0,
    state: "PENDING",
    availableFrom: "2026-04-10T00:00:00+09:00",
    dueAt: "2026-04-20T23:59:00+09:00",
    ...overrides,
  };
}

test("selectCyberCampusApprovalProbeTasks ignores unrelated lectures for single-lecture requests", () => {
  const tasks = [
    makeTask({
      lectureSeq: 101,
      externalLectureId: "A202600000101",
      courseContentsSeq: 11,
      weekNo: 1,
      lessonNo: 1,
    }),
    makeTask({
      lectureSeq: 202,
      externalLectureId: "A202600000202",
      courseContentsSeq: 21,
      weekNo: 1,
      lessonNo: 1,
    }),
  ];

  const selected = selectCyberCampusApprovalProbeTasks(tasks, {
    mode: "SINGLE_ALL",
    lectureSeq: 202,
  });

  assert.deepEqual(
    selected.map((task) => [task.lectureSeq, task.courseContentsSeq]),
    [[202, 21]],
  );
});

test("selectCyberCampusApprovalProbeTasks skips tasks outside the active learning window", () => {
  const nowMs = Date.parse("2026-04-10T12:00:00+09:00");
  const tasks = [
    makeTask({
      lectureSeq: 101,
      courseContentsSeq: 11,
      weekNo: 1,
      lessonNo: 1,
      availableFrom: "2026-04-11T00:00:00+09:00",
    }),
    makeTask({
      lectureSeq: 101,
      courseContentsSeq: 12,
      weekNo: 1,
      lessonNo: 2,
      dueAt: "2026-04-09T23:59:00+09:00",
    }),
    makeTask({
      lectureSeq: 101,
      courseContentsSeq: 13,
      weekNo: 2,
      lessonNo: 1,
      availableFrom: "2026-04-10T00:00:00+09:00",
      dueAt: "2026-04-20T23:59:00+09:00",
    }),
  ];

  const selected = selectCyberCampusApprovalProbeTasks(tasks, {
    mode: "SINGLE_NEXT",
    lectureSeq: 101,
  }, nowMs);

  assert.deepEqual(
    selected.map((task) => [task.courseContentsSeq, task.weekNo, task.lessonNo]),
    [[13, 2, 1]],
  );
});

test("selectCyberCampusApprovalProbeTasks keeps all runnable all-course tasks in autolearn order", () => {
  const tasks = [
    makeTask({
      lectureSeq: 303,
      externalLectureId: "A202600000303",
      courseContentsSeq: 31,
      weekNo: 3,
      lessonNo: 2,
    }),
    makeTask({
      lectureSeq: 101,
      externalLectureId: "A202600000101",
      courseContentsSeq: 11,
      weekNo: 1,
      lessonNo: 3,
    }),
    makeTask({
      lectureSeq: 202,
      externalLectureId: "A202600000202",
      courseContentsSeq: 21,
      weekNo: 1,
      lessonNo: 1,
    }),
    makeTask({
      lectureSeq: 404,
      externalLectureId: "A202600000404",
      courseContentsSeq: 41,
      weekNo: 1,
      lessonNo: 2,
      state: "COMPLETED",
    }),
  ];

  const selected = selectCyberCampusApprovalProbeTasks(tasks, {
    mode: "ALL_COURSES",
    lectureSeq: null,
  });

  assert.deepEqual(
    selected.map((task) => [task.lectureSeq, task.courseContentsSeq]),
    [
      [202, 21],
      [101, 11],
      [303, 31],
    ],
  );
});

test("NO_PENDING_TASKS approval result completes blocked autolearn as a no-op instead of resuming it", () => {
  assert.equal(shouldResumeBlockedAutoLearnForApprovalContext("NO_PENDING_TASKS"), false);
  assert.deepEqual(
    buildCyberCampusApprovalNoPendingAutoLearnResult({
      mode: "ALL_COURSES",
      lectureSeq: null,
    }),
    {
      type: "AUTOLEARN",
      mode: "ALL_COURSES",
      processedTaskCount: 0,
      elapsedSeconds: 0,
      lectureSeqs: [],
      plannedTaskCount: 0,
      truncated: false,
      estimatedTotalSeconds: 0,
      noOpReason: "NO_PENDING_TASKS",
      planned: [],
    },
  );
});
