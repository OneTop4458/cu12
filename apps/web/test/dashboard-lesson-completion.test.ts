import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { prisma } from "../src/lib/prisma";
import {
  combineDashboardSummaries,
  createEmptyDashboardSummary,
  getCourses,
  getLearningTaskCompletionRatio,
  isLearningTaskEligible,
} from "../src/server/dashboard";

function swapMethod(
  t: TestContext,
  target: object,
  key: PropertyKey,
  replacement: unknown,
) {
  const original = Reflect.get(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value: replacement,
  });
  t.after(() => {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value: original,
    });
  });
}

function courseRow() {
  const syncedAt = new Date("2026-09-02T00:00:00.000Z");
  return {
    id: "course-lesson-completion",
    userId: "user-lesson-completion",
    lectureSeq: 101,
    externalLectureId: null,
    title: "Lesson completion course",
    instructor: null,
    progressPercent: 12,
    remainDays: null,
    recentLearnedAt: null,
    periodStart: null,
    periodEnd: null,
    status: "ACTIVE",
    syncedAt,
    createdAt: syncedAt,
    updatedAt: syncedAt,
  };
}

function taskRow(input: {
  courseContentsSeq: number;
  weekNo: number;
  state: "PENDING" | "COMPLETED";
  availableFrom: Date | null;
  requiredSeconds?: number;
  learnedSeconds?: number;
}) {
  return {
    lectureSeq: 101,
    courseContentsSeq: input.courseContentsSeq,
    weekNo: input.weekNo,
    lessonNo: 1,
    activityType: "VOD",
    state: input.state,
    requiredSeconds: input.requiredSeconds ?? 100,
    learnedSeconds: input.learnedSeconds ?? (input.state === "COMPLETED" ? 100 : 0),
    availableFrom: input.availableFrom,
    dueAt: null,
  };
}

test("lesson completion ratio clamps partial VOD and keeps non-video tasks binary", () => {
  assert.equal(getLearningTaskCompletionRatio({
    activityType: "VOD",
    state: "RUNNING",
    requiredSeconds: 100,
    learnedSeconds: 50,
  }), 0.5);
  assert.equal(getLearningTaskCompletionRatio({
    activityType: "VOD",
    state: "RUNNING",
    requiredSeconds: 100,
    learnedSeconds: 150,
  }), 1);
  assert.equal(getLearningTaskCompletionRatio({
    activityType: "VOD",
    state: "COMPLETED",
    requiredSeconds: 100,
    learnedSeconds: 90,
  }), 1);
  assert.equal(getLearningTaskCompletionRatio({
    activityType: "QUIZ",
    state: "RUNNING",
    requiredSeconds: 0,
    learnedSeconds: 1,
  }), 0);
  assert.equal(getLearningTaskCompletionRatio({
    activityType: "QUIZ",
    state: "COMPLETED",
    requiredSeconds: 0,
    learnedSeconds: 0,
  }), 1);
});

test("future learning tasks are excluded from course lesson completion and become eligible later", async (t) => {
  const now = Date.now();
  const future = new Date(now + 60 * 60 * 1000);
  const tasks = Array.from({ length: 6 }, (_, index) => taskRow({
    courseContentsSeq: index + 1,
    weekNo: 1,
    state: "COMPLETED",
    availableFrom: new Date(now - 60 * 60 * 1000),
  }));
  tasks[0]!.learnedSeconds = 90;
  tasks.push(taskRow({
    courseContentsSeq: 7,
    weekNo: 2,
    state: "PENDING",
    availableFrom: future,
  }));

  swapMethod(t, prisma.courseSnapshot, "findMany", async () => [courseRow()] as never);
  swapMethod(t, prisma.learningTask, "findMany", async () => tasks as never);
  swapMethod(t, prisma.courseNotice, "groupBy", async () => [] as never);

  assert.equal(isLearningTaskEligible(tasks[0], now), true);
  assert.equal(isLearningTaskEligible(tasks[6], now), false);

  const before = (await getCourses("user-lesson-completion", "CU12"))[0];
  assert.equal(before?.lessonCompletionPercent, 100);
  assert.equal(before?.eligibleTaskCount, 6);
  assert.equal(before?.eligibleCompletedTaskCount, 6);
  assert.equal(before?.currentWeekNo, 1);
  assert.equal(before?.currentWeekSummary?.pendingTaskCount, 0);

  tasks[6]!.availableFrom = new Date(now - 60 * 60 * 1000);
  const after = (await getCourses("user-lesson-completion", "CU12"))[0];
  assert.equal(after?.eligibleTaskCount, 7);
  assert.equal(after?.eligibleCompletedTaskCount, 6);
  assert.equal(after?.lessonCompletionPercent, (6 / 7) * 100);
  assert.equal(after?.currentWeekNo, 2);
  assert.equal(after?.currentWeekSummary?.pendingTaskCount, 1);
});

test("a course with no eligible learning tasks returns null lesson completion", async (t) => {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  swapMethod(t, prisma.courseSnapshot, "findMany", async () => [courseRow()] as never);
  swapMethod(t, prisma.learningTask, "findMany", async () => [taskRow({
    courseContentsSeq: 99,
    weekNo: 3,
    state: "PENDING",
    availableFrom: future,
  })] as never);
  swapMethod(t, prisma.courseNotice, "groupBy", async () => [] as never);

  const course = (await getCourses("user-lesson-completion", "CU12"))[0];
  assert.equal(course?.lessonCompletionPercent, null);
  assert.equal(course?.eligibleTaskCount, 0);
  assert.equal(course?.currentWeekSummary, null);
});

test("prior incomplete eligible weeks remain part of the completion rate", async (t) => {
  const now = Date.now();
  swapMethod(t, prisma.courseSnapshot, "findMany", async () => [courseRow()] as never);
  swapMethod(t, prisma.learningTask, "findMany", async () => [
    taskRow({
      courseContentsSeq: 1,
      weekNo: 1,
      state: "PENDING",
      availableFrom: new Date(now - 60 * 60 * 1000),
    }),
    taskRow({
      courseContentsSeq: 2,
      weekNo: 2,
      state: "COMPLETED",
      availableFrom: new Date(now - 60 * 60 * 1000),
    }),
  ] as never);
  swapMethod(t, prisma.courseNotice, "groupBy", async () => [] as never);

  const course = (await getCourses("user-lesson-completion", "CU12"))[0];
  assert.equal(course?.lessonCompletionPercent, 50);
  assert.equal(course?.eligibleTaskCount, 2);
  assert.equal(course?.currentWeekNo, 2);
  assert.equal(course?.currentWeekSummary?.pendingTaskCount, 0);
});

test("current-week dashboard markup keeps its mobile-first status contract", () => {
  const client = readFileSync(new URL("../app/dashboard/dashboard-client.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(client, /course-week-status/);
  assert.match(client, /course-week-type-chip/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*course-week-status/);
});

test("overall lesson completion is weighted by eligible task count", () => {
  const now = new Date();
  const shared = createEmptyDashboardSummary(now);
  const combined = combineDashboardSummaries({
    CU12: {
      ...shared,
      activeCourseCount: 1,
      avgLessonCompletionPercent: 50,
      eligibleTaskCount: 2,
    },
    CYBER_CAMPUS: {
      ...shared,
      activeCourseCount: 1,
      avgLessonCompletionPercent: 100,
      eligibleTaskCount: 1,
    },
  });
  assert.equal(combined.eligibleTaskCount, 3);
  assert.equal(combined.avgLessonCompletionPercent, (50 * 2 + 100) / 3);
});
