import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JobType } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { claimNextJob } from "../src/server/queue";

function stub(t: TestContext, target: object, method: string, callback: (...args: never[]) => unknown) {
  const original = Reflect.get(target, method);
  Reflect.set(target, method, callback);
  t.after(() => Reflect.set(target, method, original));
}

test("batched sync claims lock the user before checking another running sync-family job", async (t) => {
  const calls: string[] = [];
  const candidate = { id: "next", userId: "one", type: JobType.SYNC, status: "PENDING", idempotencyKey: "sync:one:CU12:full" };
  stub(t, prisma.workerHeartbeat, "findMany", async () => []);
  stub(t, prisma.jobQueue, "updateMany", async () => ({ count: 0 }));
  stub(t, prisma.jobQueue, "findMany", async () => [candidate]);
  let blocked = true;
  const tx = {
    $executeRaw: async () => { calls.push("lock"); return 1; },
    jobQueue: {
      findFirst: async () => { calls.push("check"); return blocked ? { id: "already-running" } : null; },
      updateMany: async () => { calls.push("claim"); return { count: 1 }; },
    },
  };
  stub(t, prisma, "$transaction", async (callback: never) =>
    (callback as (store: typeof tx) => Promise<unknown>)(tx));
  stub(t, prisma.jobQueue, "findUnique", async () => ({ ...candidate, status: "RUNNING" }));
  assert.equal(await claimNextJob("worker-one", [JobType.SYNC]), null);
  assert.deepEqual(calls, ["lock", "check"]);
  blocked = false;
  calls.length = 0;
  assert.equal((await claimNextJob("worker-two", [JobType.SYNC]))?.id, "next");
  assert.deepEqual(calls, ["lock", "check", "claim"]);
});
