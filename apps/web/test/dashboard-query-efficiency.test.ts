import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";
import { getCourses, getDashboardSummaries, getUpcomingDeadlines } from "../src/server/dashboard";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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

function courseRow(input: {
  id: string;
  provider: "CU12" | "CYBER_CAMPUS";
  lectureSeq: number;
  title: string;
  externalLectureId?: string | null;
  progressPercent: number;
}) {
  const syncedAt = new Date("2026-09-02T00:00:00.000Z");
  return {
    ...input,
    userId: "user-perf",
    externalLectureId: input.externalLectureId ?? null,
    instructor: null,
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

test("dashboard provider summaries share user and sync-job reads", async (t) => {
  const queryCalls = {
    courses: 0,
    tasks: 0,
    notices: 0,
    jobs: 0,
    users: 0,
  };

  swapMethod(t, prisma.courseSnapshot, "findMany", async (args: { where: { provider: string; status?: string } }) => {
    queryCalls.courses += 1;
    if (args.where.provider === "CYBER_CAMPUS") {
      assert.equal(args.where.status, undefined);
      return [
        courseRow({
          id: "cyber-legacy",
          provider: "CYBER_CAMPUS",
          lectureSeq: 201,
          title: "Shared Course",
          progressPercent: 10,
        }),
        courseRow({
          id: "cyber-current",
          provider: "CYBER_CAMPUS",
          lectureSeq: 202,
          title: "Shared Course",
          externalLectureId: "current-202",
          progressPercent: 80,
        }),
      ] as never;
    }
    assert.equal(args.where.status, "ACTIVE");
    return [courseRow({
      id: "cu-course",
      provider: "CU12",
      lectureSeq: 101,
      title: "CU Course",
      progressPercent: 60,
    })] as never;
  });
  swapMethod(t, prisma.learningTask, "findMany", async () => {
    queryCalls.tasks += 1;
    return [] as never;
  });
  swapMethod(t, prisma.courseNotice, "count", async (args: { where: { provider: string } }) => {
    queryCalls.notices += 1;
    return (args.where.provider === "CU12" ? 1 : 2) as never;
  });
  swapMethod(t, prisma.jobQueue, "findMany", async () => {
    queryCalls.jobs += 1;
    return [
      {
        status: "SUCCEEDED",
        createdAt: new Date("2026-09-02T02:00:00.000Z"),
        finishedAt: new Date("2026-09-02T02:10:00.000Z"),
        payload: { provider: "CYBER_CAMPUS" },
      },
      {
        status: "SUCCEEDED",
        createdAt: new Date("2026-09-02T01:00:00.000Z"),
        finishedAt: new Date("2026-09-02T01:10:00.000Z"),
        payload: { provider: "CU12" },
      },
    ] as never;
  });
  swapMethod(t, prisma.user, "findUnique", async () => {
    queryCalls.users += 1;
    return { isTestUser: false } as never;
  });

  const summaries = await getDashboardSummaries("user-perf");

  assert.equal(summaries.CU12.activeCourseCount, 1);
  assert.equal(summaries.CU12.avgProgress, 60);
  assert.equal(summaries.CU12.unreadNoticeCount, 1);
  assert.equal(summaries.CYBER_CAMPUS.activeCourseCount, 1);
  assert.equal(summaries.CYBER_CAMPUS.avgProgress, 80);
  assert.equal(summaries.CYBER_CAMPUS.unreadNoticeCount, 2);
  assert.equal(summaries.CYBER_CAMPUS.lastSyncAt?.toISOString(), "2026-09-02T02:10:00.000Z");
  assert.deepEqual(queryCalls, {
    courses: 2,
    tasks: 2,
    notices: 2,
    jobs: 1,
    users: 1,
  });
  // Previous implementation made 12 dependency calls: 3 course, 2 task,
  // 2 notice, 2 job, and 2 user reads. The request now makes 8.
});

test("Cyber Campus course and deadline reads derive stale ids from their course result", async (t) => {
  let courseReads = 0;
  const current = courseRow({
    id: "cyber-current",
    provider: "CYBER_CAMPUS",
    lectureSeq: 302,
    title: "One Course",
    externalLectureId: "current-302",
    progressPercent: 40,
  });
  const legacy = courseRow({
    id: "cyber-legacy",
    provider: "CYBER_CAMPUS",
    lectureSeq: 301,
    title: "One Course",
    progressPercent: 100,
  });

  swapMethod(t, prisma.courseSnapshot, "findMany", async () => {
    courseReads += 1;
    return [legacy, current] as never;
  });
  swapMethod(t, prisma.learningTask, "findMany", async () => [] as never);
  swapMethod(t, prisma.courseNotice, "groupBy", async () => [] as never);

  const courses = await getCourses("user-perf", "CYBER_CAMPUS");
  const deadlines = await getUpcomingDeadlines("user-perf", 30, "CYBER_CAMPUS");

  assert.deepEqual(courses.map((course) => course.lectureSeq), [302]);
  assert.deepEqual(deadlines, []);
  assert.equal(courseReads, 2);
  // Each request previously loaded Cyber Campus courses twice: once for stale
  // ids and once for active rows. It now loads them once per request.
});

test("dashboard bootstrap and status retain auth, timing, no-store, and compatibility fields", () => {
  const bootstrapRoute = readRepoFile("apps/web/app/api/dashboard/bootstrap/route.ts");
  const statusRoute = readRepoFile("apps/web/app/api/dashboard/status/route.ts");
  const openapi = readRepoFile("docs/04-api/openapi.yaml");

  assert.match(bootstrapRoute, /requireAuthContext\(request\)[\s\S]*if \(!context\) return jsonError\("Unauthorized", 401\)/);
  assert.match(statusRoute, /requireAuthContext\(request\)[\s\S]*if \(!context\) return jsonError\("Unauthorized", 401\)/);
  assert.match(bootstrapRoute, /const \[account, providerSummaries,[\s\S]*\] = await Promise\.all\(\[[\s\S]*timing\.measure\("account"/);
  assert.doesNotMatch(statusRoute, /getDashboardAccount|timing\.measure\("account"/);
  assert.doesNotMatch(bootstrapRoute, /listSiteNotices|timing\.measure\("site-notices"/);
  assert.doesNotMatch(statusRoute, /listSiteNotices|timing\.measure\("site-notices"/);
  assert.match(bootstrapRoute, /siteNotices: \[\],[\s\S]*maintenanceNotice: null/);
  assert.match(statusRoute, /siteNotices: \[\],[\s\S]*maintenanceNotice: null/);
  assert.match(bootstrapRoute, /applyServerTimingHeader[\s\S]*"cache-control": "no-store"/);
  assert.match(statusRoute, /applyServerTimingHeader[\s\S]*"cache-control": "no-store"/);
  assert.match(openapi, /Compatibility field\. Always empty; use GET \/api\/site-notices\?surface=TOPBAR\./);
  assert.match(openapi, /Compatibility field\. Always null; use GET \/api\/site-notices\?surface=TOPBAR\./);
});
