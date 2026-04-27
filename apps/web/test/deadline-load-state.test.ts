import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeadlineLoadState,
  finishDeadlineLoad,
  startDeadlineLoad,
} from "../src/lib/deadline-load-state";

const messages = {
  partialFailure: "partial",
  totalFailure: "total",
};

test("deadline all-load state reaches loaded on success", () => {
  const loading = startDeadlineLoad(createDeadlineLoadState<number>(), 1);
  const result = finishDeadlineLoad([
    { status: "fulfilled", value: [1, 2] },
    { status: "fulfilled", value: [3] },
  ], loading.requestId, messages);

  assert.equal(result.status, "loaded");
  assert.deepEqual(result.items, [1, 2, 3]);
  assert.equal(result.error, null);
});

test("deadline all-load state treats an empty successful response as loaded", () => {
  const result = finishDeadlineLoad([
    { status: "fulfilled", value: [] },
    { status: "fulfilled", value: [] },
  ], 4, messages);

  assert.equal(result.status, "loaded");
  assert.deepEqual(result.items, []);
  assert.equal(result.error, null);
});

test("deadline all-load state reaches loaded on partial provider failure", () => {
  const result = finishDeadlineLoad([
    { status: "fulfilled", value: [1] },
    { status: "rejected", reason: new Error("provider failed") },
  ], 2, messages);

  assert.equal(result.status, "loaded");
  assert.deepEqual(result.items, [1]);
  assert.equal(result.error, "partial");
});

test("deadline all-load state reaches error when every provider fails", () => {
  const result = finishDeadlineLoad<number>([
    { status: "rejected", reason: new Error("first") },
    { status: "rejected", reason: new Error("second") },
  ], 3, messages);

  assert.equal(result.status, "error");
  assert.equal(result.items, null);
  assert.equal(result.error, "total");
});
