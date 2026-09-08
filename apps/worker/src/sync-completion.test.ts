import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "./prisma";
import { completeSyncSnapshot } from "./sync-completion";

function stub(t: TestContext, target: object, method: string, callback: (...args: never[]) => unknown) {
  const original = Reflect.get(target, method);
  Reflect.set(target, method, callback);
  t.after(() => Reflect.set(target, method, original));
}

function setup(t: TestContext) {
  const events: string[] = [];
  const checkpoints: unknown[] = [];
  stub(t, prisma.courseSnapshot, "updateMany", async () => { events.push("persist"); return { count: 0 }; });
  stub(t, prisma.courseNotice, "findMany", async () => []);
  stub(t, prisma.portalMessage, "count", async () => 0);
  stub(t, prisma.providerSyncState, "upsert", async (args: never) => { events.push("checkpoint"); checkpoints.push(args); return {}; });
  return { events, checkpoints };
}

const empty = { courseRosterAuthoritative: true, courses: [], notices: [], tasks: [], notifications: [] };

test("an authoritative empty autolearn snapshot counts only after notification processing", async (t) => {
  const state = setup(t);
  await completeSyncSnapshot("one", "CYBER_CAMPUS", { ...empty, messages: [] }, "AUTOLEARN", async () => { state.events.push("notify"); });
  assert.deepEqual(state.events, ["persist", "notify", "checkpoint"]);
  assert.equal(state.checkpoints.length, 1);
  const checkpoint = state.checkpoints[0] as { create: { userId: string; provider: string; source: string } };
  assert.equal(checkpoint.create.userId, "one");
  assert.equal(checkpoint.create.provider, "CYBER_CAMPUS");
  assert.equal(checkpoint.create.source, "AUTOLEARN");
});

test("partial snapshots do not suppress the next full sync", async (t) => {
  const state = setup(t);
  await completeSyncSnapshot("one", "CU12", { ...empty, courseRosterAuthoritative: false }, "SYNC", async () => {});
  assert.equal(state.checkpoints.length, 0);
});

test("persistence or notification failure never advances snapshot freshness", async (t) => {
  const state = setup(t);
  await assert.rejects(completeSyncSnapshot("one", "CU12", empty, "SYNC", async () => { throw new Error("notify failed"); }), /notify failed/);
  assert.equal(state.checkpoints.length, 0);
  stub(t, prisma.courseSnapshot, "updateMany", async () => { throw new Error("persist failed"); });
  await assert.rejects(completeSyncSnapshot("one", "CU12", empty, "SYNC", async () => { throw new Error("must not notify"); }), /persist failed/);
  assert.equal(state.checkpoints.length, 0);
});
