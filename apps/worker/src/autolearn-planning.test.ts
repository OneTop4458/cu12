import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LearningTask } from "@cu12/core";
import { buildTaskPlan, CU12_LOGIN_NAVIGATION_TIMEOUT_MS } from "./cu12-automation";

function createTask(input: Partial<LearningTask> & Pick<LearningTask, "lectureSeq" | "courseContentsSeq" | "activityType">): LearningTask {
  return {
    userId: "user-1",
    lectureSeq: input.lectureSeq,
    courseContentsSeq: input.courseContentsSeq,
    weekNo: input.weekNo ?? 1,
    lessonNo: input.lessonNo ?? input.courseContentsSeq,
    taskTitle: input.taskTitle ?? `Task ${input.courseContentsSeq}`,
    activityType: input.activityType,
    requiredSeconds: input.requiredSeconds ?? 0,
    learnedSeconds: input.learnedSeconds ?? 0,
    state: input.state ?? "PENDING",
    availableFrom: input.availableFrom ?? null,
    dueAt: input.dueAt ?? null,
  };
}

test("CU12 autolearn login navigation allows 120 seconds for slow portal responses", () => {
  assert.equal(CU12_LOGIN_NAVIGATION_TIMEOUT_MS, 120_000);

  const source = readFileSync(new URL("./cu12-automation.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /login_form\.acl`,\s*\{\s*waitUntil:\s*"domcontentloaded",\s*timeout:\s*CU12_LOGIN_NAVIGATION_TIMEOUT_MS,/s,
  );
});

test("buildTaskPlan skips quiz tasks when quiz auto-solve is disabled", () => {
  const result = buildTaskPlan({
    mode: "SINGLE_ALL",
    lectureSeqs: [101],
    lectureSeq: 101,
    courseTitleBySeq: new Map([[101, "Psychology"]]),
    tasksByLecture: new Map([
      [101, [
        createTask({ lectureSeq: 101, courseContentsSeq: 1, activityType: "QUIZ", lessonNo: 1 }),
        createTask({ lectureSeq: 101, courseContentsSeq: 2, activityType: "MATERIAL", lessonNo: 2 }),
      ]],
    ]),
    quizAutoSolveEnabled: false,
  });

  assert.equal(result.noOpReason, null);
  assert.deepEqual(result.planned.map((row) => row.task.activityType), ["MATERIAL"]);
});

test("buildTaskPlan reports no supported tasks when only quiz remains and quiz auto-solve is disabled", () => {
  const result = buildTaskPlan({
    mode: "SINGLE_ALL",
    lectureSeqs: [101],
    lectureSeq: 101,
    courseTitleBySeq: new Map([[101, "Psychology"]]),
    tasksByLecture: new Map([
      [101, [
        createTask({ lectureSeq: 101, courseContentsSeq: 1, activityType: "QUIZ", lessonNo: 1 }),
      ]],
    ]),
    quizAutoSolveEnabled: false,
  });

  assert.equal(result.planned.length, 0);
  assert.equal(result.noOpReason, "NO_PENDING_SUPPORTED_TASKS");
});

test("buildTaskPlan includes quiz tasks when quiz auto-solve is enabled", () => {
  const result = buildTaskPlan({
    mode: "SINGLE_ALL",
    lectureSeqs: [101],
    lectureSeq: 101,
    courseTitleBySeq: new Map([[101, "Psychology"]]),
    tasksByLecture: new Map([
      [101, [
        createTask({ lectureSeq: 101, courseContentsSeq: 1, activityType: "QUIZ", lessonNo: 1 }),
      ]],
    ]),
    quizAutoSolveEnabled: true,
  });

  assert.equal(result.noOpReason, null);
  assert.deepEqual(result.planned.map((row) => row.task.activityType), ["QUIZ"]);
});
