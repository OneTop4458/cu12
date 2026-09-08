import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "course-status-fixture".repeat(2), APP_MASTER_KEY: "course-status-fixture".repeat(2),
  WORKER_SHARED_TOKEN: "course-status-fixture".repeat(2),
});
const unexpected = async () => { throw new Error("Unexpected course-status test query"); };
globalThis.__cu12_prisma = {
  user: { findUnique: unexpected }, courseSnapshot: { findMany: unexpected }, $queryRaw: unexpected,
} as unknown as PrismaClient;
const { prisma } = await import("../src/lib/prisma");
const { GET } = await import("../app/api/dashboard/courses/route");
const { signSessionToken, signIdleSessionToken } = await import("../src/lib/auth");
const { invalidateCachedAuthState } = await import("../src/server/auth-state-cache");

function fixture(failOrm = false, failRaw = false) {
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
  mock.method(prisma.user, "findUnique", async () => ({
    id: "course-status-user", email: "member@example.test", role: "USER",
    isActive: true, approvalStatus: "APPROVED", withdrawnAt: null,
  }));
  mock.method(prisma.courseSnapshot, "findMany", async () => {
    if (failOrm) throw new Error("private-query-fixture");
    return [];
  });
  return mock.method(prisma, "$queryRaw", async () => {
    if (failRaw) throw new Error("private-query-fixture");
    return [];
  });
}
async function request() {
  const token = await signSessionToken({ userId: "course-status-user", email: "member@example.test", role: "USER" });
  const idle = await signIdleSessionToken("course-status-user");
  return new NextRequest("https://cu12.test/api/dashboard/courses?provider=CU12", {
    headers: { cookie: `cu12_session=${token}; cu12_idle=${idle}` },
  });
}
test.afterEach(() => { mock.restoreAll(); invalidateCachedAuthState("course-status-user"); });

test("a genuinely empty course read returns 200 with an empty collection", async () => {
  fixture();
  const response = await GET(await request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { courses: [] });
});
test("legacy raw-read recovery remains available before reporting course failure", async () => {
  const raw = fixture(true, false);
  const response = await GET(await request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { courses: [] });
  assert.equal(raw.mock.callCount(), 1);
});
test("unrecoverable course reads return sanitized 503 instead of a successful empty list", async () => {
  fixture(true, true);
  const response = await GET(await request());
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.errorCode, "DASHBOARD_COURSES_FAILED");
  assert.equal("courses" in payload, false);
  assert.doesNotMatch(JSON.stringify(payload), /private-query-fixture/);
});
