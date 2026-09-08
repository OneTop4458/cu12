import assert from "node:assert/strict";
import test from "node:test";
import { canClaimSyncBatchJob, getSyncBatchPolicy, resolveSyncBatchUserId } from "./sync-batch";

test("short sync batching never changes autolearn, mail, or continuous-worker execution", () => {
  for (const types of [[], ["AUTOLEARN"], ["MAIL_DIGEST"], ["SYNC", "AUTOLEARN"]]) {
    assert.equal(getSyncBatchPolicy(types, true), null);
  }
  assert.equal(getSyncBatchPolicy(["SYNC"], false), null);
  assert.equal(getSyncBatchPolicy(["SYNC", "NOTICE_SCAN"], true)?.idleGraceMs, 15_000);
});

test("a sync batch stops new claims at either the count or time boundary", () => {
  const policy = getSyncBatchPolicy(["SYNC"], true)!;
  assert.equal(canClaimSyncBatchJob(policy, 0, 0), true);
  assert.equal(canClaimSyncBatchJob(policy, 9, 599_999), true);
  assert.equal(canClaimSyncBatchJob(policy, 10, 1), false);
  assert.equal(canClaimSyncBatchJob(policy, 1, 600_000), false);
});

test("new workers remain user-scoped until the claim API advertises transactional batch support", () => {
  assert.equal(resolveSyncBatchUserId("one", 3, false), "one");
  assert.equal(resolveSyncBatchUserId("one", 0, true), "one");
  assert.equal(resolveSyncBatchUserId("one", 1, true), undefined);
});
