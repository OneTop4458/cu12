import assert from "node:assert/strict";
import test from "node:test";
import { JobType } from "@prisma/client";
import { shouldQueueAutoLearnContinuation, shouldRetryFailedJob } from "../src/server/queue";

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
