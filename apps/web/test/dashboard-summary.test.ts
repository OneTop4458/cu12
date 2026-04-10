import assert from "node:assert/strict";
import test from "node:test";
import { combineDashboardSummaries, createEmptyDashboardSummary, type DashboardSummary } from "../src/server/dashboard";

function makeSummary(input: Partial<DashboardSummary>): DashboardSummary {
  return {
    activeCourseCount: 0,
    avgProgress: 0,
    unreadNoticeCount: 0,
    upcomingDeadlines: 0,
    urgentTaskCount: 0,
    nextDeadlineAt: null,
    lastSyncAt: null,
    nextAutoSyncAt: new Date("2026-04-08T00:00:00.000Z"),
    autoSyncIntervalHours: 2,
    initialSyncRequired: false,
    ...input,
  };
}

test("combineDashboardSummaries sums counts and keeps weighted progress", () => {
  const combined = combineDashboardSummaries({
    CU12: makeSummary({
      activeCourseCount: 2,
      avgProgress: 50,
      unreadNoticeCount: 3,
      upcomingDeadlines: 1,
      urgentTaskCount: 1,
      nextDeadlineAt: new Date("2026-04-10T00:00:00.000Z"),
      lastSyncAt: new Date("2026-04-08T01:00:00.000Z"),
      nextAutoSyncAt: new Date("2026-04-08T04:00:00.000Z"),
    }),
    CYBER_CAMPUS: makeSummary({
      activeCourseCount: 1,
      avgProgress: 100,
      unreadNoticeCount: 2,
      upcomingDeadlines: 2,
      urgentTaskCount: 2,
      nextDeadlineAt: new Date("2026-04-09T00:00:00.000Z"),
      lastSyncAt: new Date("2026-04-08T03:00:00.000Z"),
      nextAutoSyncAt: new Date("2026-04-08T02:00:00.000Z"),
      initialSyncRequired: true,
    }),
  });

  assert.equal(combined.activeCourseCount, 3);
  assert.equal(Math.round(combined.avgProgress), 67);
  assert.equal(combined.unreadNoticeCount, 5);
  assert.equal(combined.upcomingDeadlines, 3);
  assert.equal(combined.urgentTaskCount, 3);
  assert.equal(combined.nextDeadlineAt?.toISOString(), "2026-04-09T00:00:00.000Z");
  assert.equal(combined.lastSyncAt?.toISOString(), "2026-04-08T03:00:00.000Z");
  assert.equal(combined.nextAutoSyncAt.toISOString(), "2026-04-08T02:00:00.000Z");
  assert.equal(combined.initialSyncRequired, true);
});

test("createEmptyDashboardSummary returns zeroed counts", () => {
  const summary = createEmptyDashboardSummary(new Date("2026-04-10T00:15:00.000Z"));

  assert.deepEqual(
    {
      activeCourseCount: summary.activeCourseCount,
      avgProgress: summary.avgProgress,
      unreadNoticeCount: summary.unreadNoticeCount,
      upcomingDeadlines: summary.upcomingDeadlines,
      urgentTaskCount: summary.urgentTaskCount,
      nextDeadlineAt: summary.nextDeadlineAt,
      lastSyncAt: summary.lastSyncAt,
      autoSyncIntervalHours: summary.autoSyncIntervalHours,
      initialSyncRequired: summary.initialSyncRequired,
    },
    {
      activeCourseCount: 0,
      avgProgress: 0,
      unreadNoticeCount: 0,
      upcomingDeadlines: 0,
      urgentTaskCount: 0,
      nextDeadlineAt: null,
      lastSyncAt: null,
      autoSyncIntervalHours: 2,
      initialSyncRequired: false,
    },
  );
  assert.equal(summary.nextAutoSyncAt.toISOString(), "2026-04-10T02:00:00.000Z");
});
