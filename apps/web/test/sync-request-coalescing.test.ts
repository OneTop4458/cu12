import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prisma } from "../src/lib/prisma";
import { queueSyncJobsForUser } from "../src/server/sync-job-dispatch";

function stub(t: TestContext, target: object, method: string, callback: (...args: never[]) => unknown) {
  const original = Reflect.get(target, method);
  Reflect.set(target, method, callback);
  t.after(() => Reflect.set(target, method, original));
}

test("manual refresh reuses a legacy scheduled job for the same provider", async (t) => {
  const now = new Date();
  const existing = { id: "scheduled", userId: "one", type: "SYNC", status: "PENDING", createdAt: now, runAfter: now, startedAt: null };
  const writes: unknown[] = [];
  stub(t, prisma.jobQueue, "findFirst", async () => existing);
  stub(t, prisma.jobQueue, "create", async () => { throw new Error("must reuse existing job"); });
  stub(t, prisma.jobQueue, "updateMany", async (args: never) => { writes.push(args); return { count: 1 }; });
  const result = await queueSyncJobsForUser({ userId: "one", campus: null, reason: "manual" });
  assert.equal(result.results[0].jobId, "scheduled");
  assert.equal(result.results[0].deduplicated, true);
  assert.equal(result.dispatch.state, "SKIPPED_DUPLICATE");
  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0] as { data: { payload: unknown } }).data.payload, { userId: "one", provider: "CYBER_CAMPUS", reason: "manual" });
});

test("a manual request joins running sync without rewriting its payload", async (t) => {
  const now = new Date();
  stub(t, prisma.jobQueue, "findFirst", async () => ({ id: "running", status: "RUNNING", createdAt: now, runAfter: now, startedAt: now }));
  stub(t, prisma.jobQueue, "updateMany", async () => { throw new Error("must not modify a running job"); });
  const result = await queueSyncJobsForUser({ userId: "one", campus: "SONGSIM", requestedProviders: ["CU12"], reason: "manual" });
  assert.equal(result.results[0].jobId, "running");
  assert.equal(result.dispatch.state, "SKIPPED_DUPLICATE");
});

test("manual refresh expedites a future scheduled job and requests dispatch", async (t) => {
  for (const [key, value] of Object.entries({
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    AUTH_JWT_SECRET: "test-only-".repeat(4), APP_MASTER_KEY: "test-only-".repeat(4),
    WORKER_SHARED_TOKEN: "test-only-".repeat(4), GITHUB_TOKEN: "",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const now = new Date();
  let update: { data: { runAfter: Date; payload: { reason: string } } } | undefined;
  stub(t, prisma.jobQueue, "findFirst", async () => ({
    id: "future", status: "PENDING", createdAt: now, runAfter: new Date(now.getTime() + 60_000), startedAt: null,
  }));
  stub(t, prisma.jobQueue, "updateMany", async (args: never) => { update = args; return { count: 1 }; });
  const result = await queueSyncJobsForUser({ userId: "one", campus: null, reason: "manual" });
  assert.equal(result.results[0].jobId, "future");
  assert.equal(update?.data.payload.reason, "manual");
  assert.ok(update!.data.runAfter.getTime() < now.getTime() + 60_000);
  assert.notEqual(result.dispatch.state, "SKIPPED_DUPLICATE");
});
