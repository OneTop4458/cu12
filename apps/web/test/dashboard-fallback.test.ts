import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_CYBER_CAMPUS_APPROVAL_STATE, IDLE_SYNC_QUEUE_SUMMARY, loadOptionalDashboardSegment } from "../src/server/dashboard-fallback";

test("loadOptionalDashboardSegment returns loaded value when successful", async () => {
  const value = await loadOptionalDashboardSegment(
    "dashboard/test",
    "jobs",
    async () => ["a", "b"],
    [],
  );

  assert.deepEqual(value, ["a", "b"]);
});

test("loadOptionalDashboardSegment returns fallback when loader throws", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const value = await loadOptionalDashboardSegment(
      "dashboard/test",
      "sync-queue",
      async () => {
        throw new Error("boom");
      },
      IDLE_SYNC_QUEUE_SUMMARY,
    );

    assert.deepEqual(value, IDLE_SYNC_QUEUE_SUMMARY);
  } finally {
    console.error = originalError;
  }
});

test("dashboard fallbacks expose empty cyber campus state", () => {
  assert.deepEqual(EMPTY_CYBER_CAMPUS_APPROVAL_STATE, {
    session: {
      available: false,
      status: null,
      expiresAt: null,
      lastVerifiedAt: null,
    },
    approval: null,
  });
});
