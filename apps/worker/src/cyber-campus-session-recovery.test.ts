import assert from "node:assert/strict";
import test from "node:test";
import { retryOnceAfterEmptyStoredSession } from "./cyber-campus-session-recovery";

test("retryOnceAfterEmptyStoredSession refreshes once when a stored session returns an empty result", async () => {
  let loadCalls = 0;
  let refreshCalls = 0;

  const result = await retryOnceAfterEmptyStoredSession({
    hasStoredSession: true,
    load: async () => {
      loadCalls += 1;
      return loadCalls === 1 ? [] : ["task-1"];
    },
    isEmpty: (tasks) => tasks.length === 0,
    refresh: async () => {
      refreshCalls += 1;
    },
  });

  assert.deepEqual(result.result, ["task-1"]);
  assert.equal(result.retriedStoredSession, true);
  assert.equal(loadCalls, 2);
  assert.equal(refreshCalls, 1);
});

test("retryOnceAfterEmptyStoredSession does not refresh when no stored session exists", async () => {
  let loadCalls = 0;
  let refreshCalls = 0;

  const result = await retryOnceAfterEmptyStoredSession({
    hasStoredSession: false,
    load: async () => {
      loadCalls += 1;
      return [];
    },
    isEmpty: (tasks) => tasks.length === 0,
    refresh: async () => {
      refreshCalls += 1;
    },
  });

  assert.deepEqual(result.result, []);
  assert.equal(result.retriedStoredSession, false);
  assert.equal(loadCalls, 1);
  assert.equal(refreshCalls, 0);
});
