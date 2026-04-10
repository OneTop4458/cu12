import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../src/lib/prisma";
import { getCourses, getDashboardSummary } from "../src/server/dashboard";

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

test("getDashboardSummary falls back to raw learning task reads when ORM decoding fails", async (t) => {
  swapMethod(t, console, "warn", () => {});

  const dueAt = new Date("2026-04-12T00:00:00.000Z");
  const syncedAt = new Date("2026-04-10T00:00:00.000Z");

  swapMethod(t, prisma.courseSnapshot, "findMany", async () => [
    {
      id: "course-1",
      userId: "user-1",
      lectureSeq: 101,
      externalLectureId: null,
      title: "Recovered Course",
      instructor: null,
      progressPercent: 75,
      remainDays: 3,
      recentLearnedAt: null,
      periodStart: null,
      periodEnd: null,
      status: "ACTIVE",
      syncedAt,
      createdAt: syncedAt,
      updatedAt: syncedAt,
    },
  ] as never);
  swapMethod(t, prisma.learningTask, "findMany", async () => {
    throw new Error("invalid enum value for state");
  });
  let rawCalls = 0;
  swapMethod(t, prisma, "$queryRaw", async () => {
    rawCalls += 1;
    return [
      {
        lectureSeq: 101,
        courseContentsSeq: 5001,
        weekNo: 2,
        lessonNo: 1,
        activityType: "VIDEO",
        state: "QUEUED",
        requiredSeconds: 300,
        learnedSeconds: 0,
        availableFrom: null,
        dueAt,
      },
    ];
  });
  swapMethod(t, prisma.courseNotice, "count", async () => 2 as never);
  swapMethod(t, prisma.jobQueue, "findMany", async () => [
    {
      status: "SUCCEEDED",
      createdAt: new Date("2026-04-10T01:00:00.000Z"),
      finishedAt: new Date("2026-04-10T01:30:00.000Z"),
      payload: { provider: "CU12" },
    },
  ] as never);
  swapMethod(t, prisma.user, "findUnique", async () => ({ isTestUser: false }) as never);

  const summary = await getDashboardSummary("user-1", "CU12");

  assert.equal(summary.activeCourseCount, 1);
  assert.equal(summary.avgProgress, 75);
  assert.equal(summary.unreadNoticeCount, 2);
  assert.equal(summary.upcomingDeadlines, 1);
  assert.equal(summary.urgentTaskCount, 1);
  assert.equal(summary.nextDeadlineAt?.toISOString(), dueAt.toISOString());
  assert.equal(summary.lastSyncAt?.toISOString(), "2026-04-10T01:30:00.000Z");
  assert.equal(rawCalls, 1);
});

test("getCourses falls back to raw course, task, and notice reads when ORM queries fail", async (t) => {
  swapMethod(t, console, "warn", () => {});

  const now = new Date();
  const syncedAt = new Date("2026-04-10T00:00:00.000Z");

  swapMethod(t, prisma.courseSnapshot, "findMany", async () => {
    throw new Error("invalid enum value for course status");
  });
  swapMethod(t, prisma.learningTask, "findMany", async () => {
    throw new Error("invalid enum value for activity");
  });
  swapMethod(t, prisma.courseNotice, "groupBy", async () => {
    throw new Error("groupBy failed");
  });

  let rawCalls = 0;
  swapMethod(t, prisma, "$queryRaw", async () => {
    rawCalls += 1;
    if (rawCalls === 1) {
      return [
        {
          id: "course-2",
          userId: "user-2",
          provider: "CU12",
          lectureSeq: 202,
          externalLectureId: null,
          title: "Recovered Snapshot",
          instructor: "Instructor",
          progressPercent: 20,
          remainDays: 5,
          recentLearnedAt: null,
          periodStart: null,
          periodEnd: null,
          status: "LEGACY_ACTIVE",
          syncedAt,
          createdAt: syncedAt,
          updatedAt: syncedAt,
        },
      ];
    }
    if (rawCalls === 2) {
      return [
        {
          lectureSeq: 202,
          courseContentsSeq: 7002,
          weekNo: 4,
          lessonNo: 1,
          activityType: "QUIZ",
          state: "PENDING",
          requiredSeconds: 0,
          learnedSeconds: 0,
          availableFrom: new Date(now.getTime() - 60_000),
          dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      ];
    }
    if (rawCalls === 3) {
      return [{ lectureSeq: 202, count: 2 }];
    }
    if (rawCalls === 4) {
      return [{ lectureSeq: 202, count: 1 }];
    }
    throw new Error(`Unexpected raw query call ${rawCalls}`);
  });

  const courses = await getCourses("user-2", "CU12");

  assert.equal(courses.length, 1);
  assert.equal(courses[0]?.status, "ACTIVE");
  assert.equal(courses[0]?.noticeCount, 2);
  assert.equal(courses[0]?.unreadNoticeCount, 1);
  assert.equal(courses[0]?.pendingTaskCount, 1);
  assert.equal(courses[0]?.currentWeekNo, 4);
  assert.equal(courses[0]?.nextPendingTask?.activityType, "QUIZ");
  assert.equal(rawCalls, 4);
});
