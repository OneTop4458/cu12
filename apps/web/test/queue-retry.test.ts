import assert from "node:assert/strict";
import test from "node:test";
import { JobType } from "@prisma/client";
import {
  getFailedJobRetryDelayMinutes,
  shouldQueueAutoLearnContinuation,
  shouldRetryFailedJob,
  summarizePendingJobRows,
} from "../src/server/queue";

test("shouldRetryFailedJob keeps transient autolearn failures retryable", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 1, "AUTOLEARN_STALLED"), true);
});

test("shouldRetryFailedJob blocks blind retries for cyber campus secondary auth failures", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 1, "CYBER_CAMPUS_SECONDARY_AUTH_REQUIRED"), false);
});

test("shouldRetryFailedJob blocks retries after the retry budget is exhausted", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 4, "AUTOLEARN_STALLED"), false);
});

test("shouldQueueAutoLearnContinuation disables continuation for cyber campus jobs", () => {
  assert.equal(
    shouldQueueAutoLearnContinuation({
      provider: "CYBER_CAMPUS",
      truncated: true,
      chainLimitReached: false,
    }),
    false,
  );
  assert.equal(
    shouldQueueAutoLearnContinuation({
      provider: "CU12",
      truncated: true,
      chainLimitReached: false,
    }),
    true,
  );
});

test("getFailedJobRetryDelayMinutes keeps the existing retry schedule", () => {
  assert.equal(getFailedJobRetryDelayMinutes(1), 1);
  assert.equal(getFailedJobRetryDelayMinutes(2), 5);
  assert.equal(getFailedJobRetryDelayMinutes(3), 15);
  assert.equal(getFailedJobRetryDelayMinutes(4), 60);
});

test("summarizePendingJobRows separates eligible and future pending jobs", () => {
  const now = new Date("2026-04-29T00:10:00.000Z");
  const summary = summarizePendingJobRows([
    {
      runAfter: new Date("2026-04-29T00:09:00.000Z"),
      createdAt: new Date("2026-04-29T00:08:00.000Z"),
    },
    {
      runAfter: new Date("2026-04-29T00:15:00.000Z"),
      createdAt: new Date("2026-04-29T00:08:00.000Z"),
    },
    {
      runAfter: new Date("2026-04-29T00:20:00.000Z"),
      createdAt: new Date("2026-04-29T00:08:00.000Z"),
    },
  ], now);

  assert.equal(summary.pending, true);
  assert.equal(summary.eligiblePending, true);
  assert.equal(summary.futurePending, true);
  assert.equal(summary.nextRunAfter?.toISOString(), "2026-04-29T00:15:00.000Z");
});
