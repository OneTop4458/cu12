import assert from "node:assert/strict";
import test from "node:test";
import { JobType } from "@prisma/client";
import { shouldRetryFailedJob } from "../src/server/queue";

test("shouldRetryFailedJob keeps transient autolearn failures retryable", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 1, "AUTOLEARN_STALLED"), true);
});

test("shouldRetryFailedJob blocks blind retries for cyber campus secondary auth failures", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 1, "CYBER_CAMPUS_SECONDARY_AUTH_REQUIRED"), false);
});

test("shouldRetryFailedJob blocks retries after the retry budget is exhausted", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 4, "AUTOLEARN_STALLED"), false);
});
