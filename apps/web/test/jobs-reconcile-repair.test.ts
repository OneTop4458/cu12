import assert from "node:assert/strict";
import test from "node:test";
import { JobStatus, JobType } from "@prisma/client";
import {
  decideOrphanedRunningJobRepair,
  isSameObservedRunningJob,
  ORPHANED_WORKER_ERROR,
} from "../src/server/jobs-reconcile";
import { shouldRetryFailedJob } from "../src/server/queue";

test("orphan sync-family running jobs are returned to pending", () => {
  assert.deepEqual(
    decideOrphanedRunningJobRepair({ type: JobType.SYNC, attempts: 2 }),
    { action: "REQUEUE", retryQueued: false, retryDelayMinutes: null },
  );
  assert.deepEqual(
    decideOrphanedRunningJobRepair({ type: JobType.NOTICE_SCAN, attempts: 2 }),
    { action: "REQUEUE", retryQueued: false, retryDelayMinutes: null },
  );
});

test("orphan autolearn running jobs fail closed and reuse the retry budget", () => {
  assert.equal(shouldRetryFailedJob(JobType.AUTOLEARN, 1, ORPHANED_WORKER_ERROR), true);
  assert.deepEqual(
    decideOrphanedRunningJobRepair({ type: JobType.AUTOLEARN, attempts: 1 }),
    { action: "MARK_FAILED", retryQueued: true, retryDelayMinutes: 1 },
  );
  assert.deepEqual(
    decideOrphanedRunningJobRepair({ type: JobType.AUTOLEARN, attempts: 4 }),
    { action: "MARK_FAILED", retryQueued: false, retryDelayMinutes: null },
  );
});

test("orphan mail digest running jobs fail without automatic retry", () => {
  assert.deepEqual(
    decideOrphanedRunningJobRepair({ type: JobType.MAIL_DIGEST, attempts: 1 }),
    { action: "MARK_FAILED", retryQueued: false, retryDelayMinutes: null },
  );
});

test("orphan repair only updates the same observed running worker identity", () => {
  assert.equal(
    isSameObservedRunningJob({
      current: { status: JobStatus.RUNNING, workerId: "gha-123-1" },
      observed: { workerId: "gha-123-1" },
    }),
    true,
  );
  assert.equal(
    isSameObservedRunningJob({
      current: { status: JobStatus.RUNNING, workerId: "gha-456-1" },
      observed: { workerId: "gha-123-1" },
    }),
    false,
  );
  assert.equal(
    isSameObservedRunningJob({
      current: { status: JobStatus.PENDING, workerId: null },
      observed: { workerId: "gha-123-1" },
    }),
    false,
  );
});
