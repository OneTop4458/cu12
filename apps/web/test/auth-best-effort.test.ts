import assert from "node:assert/strict";
import test from "node:test";
import { bestEffort, bestEffortVoid } from "../src/server/auth-best-effort";

test("bestEffort returns the delegate result when no error is thrown", async () => {
  const result = await bestEffort(async () => "ok", "fallback");
  assert.equal(result, "ok");
});

test("bestEffort returns fallback when the delegate throws", async () => {
  const result = await bestEffort(async () => {
    throw new Error("boom");
  }, "fallback");
  assert.equal(result, "fallback");
});

test("bestEffortVoid swallows delegate errors", async () => {
  await assert.doesNotReject(async () => {
    await bestEffortVoid(async () => {
      throw new Error("boom");
    });
  });
});
