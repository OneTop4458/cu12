import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";
import {
  getActivity,
  getActivityAttentionCount,
  isAttentionNotification,
} from "../src/server/dashboard";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
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

test("attention count matches getActivity needsAttention semantics", async (t) => {
  const now = new Date();
  const dueAt = new Date(now.getTime() + 60 * 60 * 1000);
  const notifications = [
    { category: "Deadline", message: "Assignment due soon", isUnread: true, isCanceled: false },
    { category: "Information", message: "Course room updated", isUnread: true, isCanceled: false },
    { category: "Deadline", message: "Canceled deadline", isUnread: true, isCanceled: true },
  ];
  const messages = [
    { id: "message-unread", provider: "CU12", title: "Unread", senderName: null, bodyText: "Read me", sentAt: now, createdAt: now, isRead: false, isArchived: false },
    { id: "message-read", provider: "CU12", title: "Read", senderName: null, bodyText: "Done", sentAt: now, createdAt: now, isRead: true, isArchived: false },
  ];
  const urgentTasks = [
    { id: "task-urgent", provider: "CU12", lectureSeq: 101, weekNo: 2, lessonNo: 1, dueAt, createdAt: now },
  ];

  swapMethod(t, prisma.courseSnapshot, "findMany", async () => [{
    id: "course-active",
    userId: "user-attention",
    provider: "CU12",
    lectureSeq: 101,
    externalLectureId: null,
    title: "Active course",
    instructor: null,
    progressPercent: 20,
    remainDays: null,
    recentLearnedAt: null,
    periodStart: null,
    periodEnd: null,
    status: "ACTIVE",
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  }] as never);
  swapMethod(t, prisma.courseNotice, "findMany", async () => [{
    id: "notice-unread",
    provider: "CU12",
    title: "Unread course notice",
    bodyText: "Notice body",
    postedAt: now,
    createdAt: now,
    isRead: false,
  }] as never);
  swapMethod(t, prisma.notificationEvent, "findMany", async () => notifications.map((notification, index) => ({
    id: `notification-${index}`,
    provider: "CU12",
    courseTitle: "Active course",
    occurredAt: now,
    createdAt: now,
    isArchived: false,
    ...notification,
  })) as never);
  swapMethod(t, prisma.notificationEvent, "count", async (args: { where: { isUnread: boolean; isCanceled: boolean; isArchived: boolean; OR: unknown[] } }) => {
    assert.equal(args.where.isUnread, true);
    assert.equal(args.where.isCanceled, false);
    assert.equal(args.where.isArchived, false);
    assert.ok(args.where.OR.length > 0);
    return notifications.filter(isAttentionNotification).length as never;
  });
  swapMethod(t, prisma.portalMessage, "findMany", async () => messages as never);
  swapMethod(t, prisma.portalMessage, "count", async () => messages.filter((message) => !message.isRead).length as never);
  swapMethod(t, prisma.learningTask, "findMany", async () => urgentTasks as never);
  swapMethod(t, prisma.learningTask, "count", async (args: { where: { lectureSeq: { in: number[] }; state: string } }) => {
    assert.deepEqual(args.where.lectureSeq.in, [101]);
    assert.equal(args.where.state, "PENDING");
    return urgentTasks.length as never;
  });

  const activities = await getActivity("user-attention", "CU12", 100);
  const attentionCount = await getActivityAttentionCount("user-attention", "CU12", now);
  const attentionActivities = activities.filter((activity) => activity.needsAttention);

  assert.equal(activities.find((activity) => activity.kind === "NOTICE")?.needsAttention, false);
  assert.deepEqual(attentionActivities.map((activity) => activity.kind).sort(), ["MESSAGE", "NOTIFICATION", "SYSTEM"]);
  assert.equal(attentionCount, attentionActivities.length);
});

test("attention endpoint is authenticated, no-store, partial-safe, and count-only", () => {
  const countRoute = [
    readRepoFile("apps/web/app/api/dashboard/activity/attention-count/route.ts"),
    readRepoFile("apps/web/app/api/dashboard/activity/attention-count/handler.ts"),
  ].join("\n");
  const activityRoute = readRepoFile("apps/web/app/api/dashboard/activity/route.ts");
  const dashboardServer = readRepoFile("apps/web/src/server/dashboard.ts");
  const activityCenter = readRepoFile("apps/web/components/notifications/activity-center.tsx");
  const dashboardClient = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const openapi = readRepoFile("docs/04-api/openapi.yaml");
  const countStart = dashboardServer.indexOf("export async function getActivityAttentionCount");
  const activityStart = dashboardServer.indexOf("export async function getActivity(", countStart);
  const countImplementation = dashboardServer.slice(countStart, activityStart);

  assert.match(countRoute, /authenticate: requireAuthContext/);
  assert.match(countRoute, /dependencies\.authenticate\(request\)[\s\S]+?jsonError\("Unauthorized", 401\)/);
  assert.match(countRoute, /PORTAL_PROVIDERS\.map/);
  assert.match(countRoute, /loadOptionalDashboardSegment\([\s\S]+?getActivityAttentionCount[\s\S]+?0,/);
  assert.match(countRoute, /headers\.set\("cache-control", "no-store"\)/);
  assert.doesNotMatch(countRoute, /getActivity\(/);
  assert.match(activityRoute, /getActivityAttentionCount/);
  assert.match(activityRoute, /attentionCounts\.reduce/);
  assert.match(activityRoute, /"cache-control": "no-store"/);
  assert.match(countImplementation, /notificationEvent\.count/);
  assert.match(countImplementation, /portalMessage\.count/);
  assert.match(countImplementation, /learningTask\.count/);
  assert.doesNotMatch(countImplementation, /courseNotice|findMany/);
  assert.match(activityCenter, /void loadAttentionCount\(\)/);
  assert.match(activityCenter, /\/api\/dashboard\/activity\/attention-count/);
  assert.match(activityCenter, /\/api\/dashboard\/activity\?limit=80/);
  assert.match(activityCenter, /cache: "no-store"/);
  assert.match(activityCenter, /await loadAttentionCount\(\)/);
  assert.doesNotMatch(activityCenter, /void loadLatest\(true\);\s*return \(\)/);
  assert.doesNotMatch(dashboardClient, /activityUnreadCount/);
  assert.match(openapi, /\/api\/dashboard\/activity\/attention-count:/);
  assert.match(openapi, /Course notices are excluded/);
});
