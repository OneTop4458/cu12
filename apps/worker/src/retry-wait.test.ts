import assert from "node:assert/strict";
import test from "node:test";
import { decideRetryWait } from "./retry-wait";

test("decideRetryWait waits for retry jobs inside the once-worker cap", () => {
  const decision = decideRetryWait({
    retryQueued: true,
    retryJob: {
      id: "retry-1",
      type: "AUTOLEARN",
      userId: "user-1",
      runAfter: "2026-04-29T00:05:00.000Z",
    },
    nowMs: Date.parse("2026-04-29T00:00:00.000Z"),
    maxWaitMs: 20 * 60 * 1000,
  });

  assert.equal(decision.shouldWait, true);
  assert.equal(decision.waitMs, 5 * 60 * 1000);
  assert.equal(decision.reason, "due_soon");
});

test("decideRetryWait immediately continues when retry is already due", () => {
  const decision = decideRetryWait({
    retryQueued: true,
    retryJob: {
      id: "retry-1",
      type: "SYNC",
      userId: "user-1",
      runAfter: "2026-04-29T00:00:00.000Z",
    },
    nowMs: Date.parse("2026-04-29T00:01:00.000Z"),
    maxWaitMs: 20 * 60 * 1000,
  });

  assert.equal(decision.shouldWait, true);
  assert.equal(decision.waitMs, 0);
  assert.equal(decision.reason, "due_now");
});

test("decideRetryWait skips retry jobs outside the wait cap", () => {
  const decision = decideRetryWait({
    retryQueued: true,
    retryJob: {
      id: "retry-1",
      type: "AUTOLEARN",
      userId: "user-1",
      runAfter: "2026-04-29T01:00:00.000Z",
    },
    nowMs: Date.parse("2026-04-29T00:00:00.000Z"),
    maxWaitMs: 20 * 60 * 1000,
  });

  assert.equal(decision.shouldWait, false);
  assert.equal(decision.reason, "outside_wait_cap");
});
