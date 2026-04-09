import assert from "node:assert/strict";
import test from "node:test";
import { evaluateServiceHealth } from "../src/server/health";

test("evaluateServiceHealth returns ok when core checks are healthy", () => {
  const result = evaluateServiceHealth({
    databaseOk: true,
    dispatchConfigured: true,
    activeWorkerCount: 1,
    latestHeartbeatAgeMs: 30_000,
    runningCount: 1,
    pendingCount: 0,
    blockedCount: 0,
    staleRunningCount: 0,
    stalePendingCount: 0,
    backlogWarningThreshold: 10,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.workerOk, true);
  assert.equal(result.workerDispatchOk, true);
  assert.equal(result.queueOk, true);
  assert.deepEqual(result.issues, []);
});

test("evaluateServiceHealth returns degraded when worker dispatch is missing", () => {
  const result = evaluateServiceHealth({
    databaseOk: true,
    dispatchConfigured: false,
    activeWorkerCount: 0,
    latestHeartbeatAgeMs: null,
    runningCount: 0,
    pendingCount: 0,
    blockedCount: 0,
    staleRunningCount: 0,
    stalePendingCount: 0,
    backlogWarningThreshold: 10,
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.workerDispatchOk, false);
  assert.match(result.issues.join(" "), /Worker dispatch is not fully configured/);
});

test("evaluateServiceHealth returns degraded when queue is stale", () => {
  const result = evaluateServiceHealth({
    databaseOk: true,
    dispatchConfigured: true,
    activeWorkerCount: 0,
    latestHeartbeatAgeMs: 600_000,
    runningCount: 2,
    pendingCount: 12,
    blockedCount: 0,
    staleRunningCount: 1,
    stalePendingCount: 3,
    backlogWarningThreshold: 10,
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.workerOk, false);
  assert.equal(result.queueOk, false);
  assert.match(result.issues.join(" "), /No active worker heartbeat is available while jobs exist/);
  assert.match(result.issues.join(" "), /pending job\(s\) have been waiting longer than 10 minutes/);
  assert.match(result.issues.join(" "), /Pending queue depth 12 exceeds warning threshold 10/);
});

test("evaluateServiceHealth returns error when database check fails", () => {
  const result = evaluateServiceHealth({
    databaseOk: false,
    dispatchConfigured: true,
    activeWorkerCount: 1,
    latestHeartbeatAgeMs: 10_000,
    runningCount: 0,
    pendingCount: 0,
    blockedCount: 0,
    staleRunningCount: 0,
    stalePendingCount: 0,
    backlogWarningThreshold: 10,
  });

  assert.equal(result.status, "error");
  assert.deepEqual(result.issues, ["Database connectivity check failed."]);
});
