import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveJobDedupeKey,
  insertActiveJobOrGetExisting,
  isActiveJobDedupeConflict,
} from "@cu12/core";

const input = {
  userId: "user-1",
  type: "SYNC",
  status: "PENDING",
  idempotencyKey: "sync:user-1:CU12:manual",
};

function conflict() {
  return {
    code: "P2002",
    meta: { target: ["activeDedupeKey"] },
  };
}

test("active dedupe keys exist only for pending and running keyed jobs", () => {
  const pending = buildActiveJobDedupeKey(input);
  const running = buildActiveJobDedupeKey({ ...input, status: "RUNNING" });

  assert.equal(typeof pending, "string");
  assert.equal(running, pending);
  for (const status of ["BLOCKED", "SUCCEEDED", "FAILED", "CANCELED"]) {
    assert.equal(buildActiveJobDedupeKey({ ...input, status }), null);
  }
  assert.equal(buildActiveJobDedupeKey({ ...input, idempotencyKey: null }), null);
  assert.notEqual(buildActiveJobDedupeKey({ ...input, type: "AUTOLEARN" }), pending);
});

test("ten parallel inserts return one active job id and nine deduplicated results", async () => {
  const activeDedupeKey = buildActiveJobDedupeKey(input)!;
  const active = new Map<string, { id: string }>();
  let insertCount = 0;

  const results = await Promise.all(Array.from({ length: 10 }, () =>
    insertActiveJobOrGetExisting({
      activeDedupeKey,
      insert: async () => {
        await Promise.resolve();
        if (active.has(activeDedupeKey)) throw conflict();
        const job = { id: `job-${++insertCount}` };
        active.set(activeDedupeKey, job);
        return job;
      },
      findActive: async (key) => active.get(key) ?? null,
      isActiveDedupeConflict: isActiveJobDedupeConflict,
    })));

  assert.equal(active.size, 1);
  assert.equal(insertCount, 1);
  assert.deepEqual(new Set(results.map((result) => result.job.id)), new Set(["job-1"]));
  assert.equal(results.filter((result) => result.deduplicated).length, 9);
});

test("terminal completion releases the key so the same logical job can be created again", async () => {
  const activeDedupeKey = buildActiveJobDedupeKey(input)!;
  const active = new Map<string, { id: string }>();
  let nextId = 0;
  const enqueue = () => insertActiveJobOrGetExisting({
    activeDedupeKey,
    insert: async () => {
      if (active.has(activeDedupeKey)) throw conflict();
      const job = { id: `job-${++nextId}` };
      active.set(activeDedupeKey, job);
      return job;
    },
    findActive: async (key) => active.get(key) ?? null,
    isActiveDedupeConflict: isActiveJobDedupeConflict,
  });

  assert.deepEqual(await enqueue(), { job: { id: "job-1" }, deduplicated: false });
  active.delete(activeDedupeKey);
  assert.deepEqual(await enqueue(), { job: { id: "job-2" }, deduplicated: false });
});

test("only the activeDedupeKey unique constraint is treated as a dedupe conflict", () => {
  assert.equal(isActiveJobDedupeConflict(conflict()), true);
  assert.equal(isActiveJobDedupeConflict({ code: "P2002", meta: { target: ["id"] } }), false);
  assert.equal(isActiveJobDedupeConflict({ code: "P2003" }), false);
});
