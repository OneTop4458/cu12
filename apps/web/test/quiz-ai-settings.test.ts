import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { DEFAULT_QUIZ_MODEL } from "@cu12/core";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "quiz-model-fixture".repeat(3), APP_MASTER_KEY: "quiz-model-fixture".repeat(3),
  WORKER_SHARED_TOKEN: "quiz-model-fixture".repeat(3),
});
const unexpected = async () => { throw new Error("Unexpected database query"); };
globalThis.__cu12_prisma = {
  user: { findUnique: unexpected }, auditLog: { create: unexpected },
  appSettings: { findUnique: unexpected, upsert: unexpected },
} as unknown as PrismaClient;
const { prisma } = await import("../src/lib/prisma");
const { signSessionToken, signIdleSessionToken } = await import("../src/lib/auth");
const { invalidateCachedAuthState } = await import("../src/server/auth-state-cache");
const { GET, PATCH } = await import("../app/api/admin/quiz-ai/route");

function fixture() {
  const state = { model: DEFAULT_QUIZ_MODEL as string, role: "ADMIN", memberApprovalRequired: false };
  mock.method(prisma.user, "findUnique", async () => ({ id: "quiz-admin", email: "admin@example.test", role: state.role, isActive: true, approvalStatus: "APPROVED", withdrawnAt: null }));
  mock.method(prisma.auditLog, "create", async () => ({}));
  mock.method(prisma.appSettings, "findUnique", async () => ({ quizModel: state.model }));
  const write = mock.method(prisma.appSettings, "upsert", async ({ update }: { update: { quizModel: string } }) => {
    assert.deepEqual(Object.keys(update), ["quizModel"]);
    state.model = update.quizModel;
    return { quizModel: state.model };
  });
  return { state, write };
}

async function request(method: string, body?: unknown, origin = "https://cu12.test") {
  const session = await signSessionToken({ userId: "quiz-admin", email: "admin@example.test", role: "ADMIN" });
  const idle = await signIdleSessionToken("quiz-admin");
  return new NextRequest("https://cu12.test/api/admin/quiz-ai", {
    method, headers: { host: "cu12.test", origin, "content-type": "application/json", cookie: `cu12_session=${session}; cu12_idle=${idle}` },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
test.afterEach(() => { mock.restoreAll(); invalidateCachedAuthState("quiz-admin"); });

test("quiz settings require an active administrator and same-origin writes", async () => {
  const f = fixture();
  assert.equal((await GET(new NextRequest("https://cu12.test/api/admin/quiz-ai"))).status, 403);
  assert.equal((await PATCH(await request("PATCH", { model: DEFAULT_QUIZ_MODEL }, "https://other.test"))).status, 403);
  f.state.role = "USER";
  assert.equal((await GET(await request("GET"))).status, 403);
  assert.equal(f.write.mock.callCount(), 0);
});

test("quiz model saves and reloads without changing member approval", async () => {
  const f = fixture();
  const saved = await PATCH(await request("PATCH", { model: " gpt-5.6-terra " }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { model: "gpt-5.6-terra" });
  const read = await GET(await request("GET"));
  assert.equal(read.headers.get("cache-control"), "no-store");
  assert.deepEqual(await read.json(), { model: "gpt-5.6-terra" });
  assert.equal(f.state.memberApprovalRequired, false);
});

test("invalid models and unrelated settings are rejected before writes", async () => {
  const f = fixture();
  for (const body of [{ model: "" }, { model: "x".repeat(101) }, { model: "https://other.test/model" }, { model: "sk-secret-fixture" }, { model: DEFAULT_QUIZ_MODEL, memberApprovalRequired: false }]) {
    assert.equal((await PATCH(await request("PATCH", body))).status, 400);
  }
  assert.equal(f.write.mock.callCount(), 0);
});

test("missing rows use the documented default while persistence failures remain errors", async () => {
  fixture();
  mock.method(prisma.appSettings, "findUnique", async () => null);
  assert.deepEqual(await (await GET(await request("GET"))).json(), { model: DEFAULT_QUIZ_MODEL });
  mock.method(prisma.appSettings, "upsert", async () => { throw new Error("unavailable"); });
  assert.equal((await PATCH(await request("PATCH", { model: "gpt-5.6-terra" }))).status, 503);
});
