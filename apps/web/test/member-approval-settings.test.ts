import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "12345678901234567890123456789012",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
});

const unexpectedQuery = async () => { throw new Error("Unexpected database query in approval test"); };
globalThis.__cu12_prisma = {
  authRateLimit: { findMany: unexpectedQuery, deleteMany: unexpectedQuery },
  user: { findMany: unexpectedQuery, findUnique: unexpectedQuery, findUniqueOrThrow: unexpectedQuery, create: unexpectedQuery, update: unexpectedQuery, updateMany: unexpectedQuery },
  appSettings: { findUnique: unexpectedQuery, upsert: unexpectedQuery },
  cu12Account: { findFirst: unexpectedQuery, findUnique: unexpectedQuery, create: unexpectedQuery, update: unexpectedQuery },
  auditLog: { create: unexpectedQuery },
  policyDocument: { findMany: unexpectedQuery },
  userPolicyConsent: { findMany: unexpectedQuery },
  $transaction: unexpectedQuery,
} as unknown as PrismaClient;
const { prisma } = await import("../src/lib/prisma");
const { POST: login } = await import("../app/api/auth/login/route");
const { GET, PATCH } = await import("../app/api/admin/settings/route");
const { getMemberApprovalRequired } = await import("../src/server/member-approval");
const { signSessionToken, signIdleSessionToken } = await import("../src/lib/auth");
const { invalidateCachedAuthState } = await import("../src/server/auth-state-cache");

function fixture(approvalRequired: boolean | null = null) {
  const baseline = {
    id: "fixture-user", email: "student-fixture", name: "Fixture", role: "USER" as "USER" | "ADMIN",
    isActive: false, isTestUser: false, withdrawnAt: null as Date | null,
    approvalStatus: "PENDING" as "PENDING" | "APPROVED" | "REJECTED",
    approvalRequestedAt: new Date(), createdAt: new Date(), passwordHash: "unused",
  };
  let user: typeof baseline | null = null;
  const state = {
    baseline,
    get user() { return user; },
    set user(value: typeof baseline | null) { user = value; },
    approvalRequired,
    validPortal: true,
    linked: false,
    consented: false,
  };
  mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    isError: !state.validPortal, message: state.validPortal ? "OK" : "Invalid credentials",
  }), { headers: { "content-type": "application/json" } }));
  mock.method(prisma.authRateLimit, "findMany", async () => []);
  mock.method(prisma.authRateLimit, "deleteMany", async () => ({ count: 0 }));
  mock.method(prisma, "$transaction", async () => [{ blockedUntil: null }]);
  mock.method(prisma.auditLog, "create", async () => ({}));
  mock.method(prisma.user, "findMany", async () => []);
  mock.method(prisma.user, "findUnique", async () => user);
  mock.method(prisma.user, "findUniqueOrThrow", async () => user);
  const createUser = mock.method(prisma.user, "create", async ({ data }: Prisma.UserCreateArgs) => {
    user = { ...baseline, ...data } as typeof baseline;
    return user;
  });
  mock.method(prisma.user, "update", async ({ data }: Prisma.UserUpdateArgs) => {
    user = { ...user!, ...data } as typeof baseline;
    return user;
  });
  const approve = mock.method(prisma.user, "updateMany", async ({ where, data }: Prisma.UserUpdateManyArgs) => {
    if (user?.approvalStatus !== where?.approvalStatus || user?.withdrawnAt !== null) return { count: 0 };
    user = { ...user, ...data } as typeof baseline;
    return { count: 1 };
  });
  const settingRead = mock.method(prisma.appSettings, "findUnique", async () =>
    state.approvalRequired === null ? null : { memberApprovalRequired: state.approvalRequired });
  const settingWrite = mock.method(prisma.appSettings, "upsert", async ({ update }: Prisma.AppSettingsUpsertArgs) => {
    state.approvalRequired = update.memberApprovalRequired as boolean;
    return { memberApprovalRequired: state.approvalRequired };
  });
  mock.method(prisma.cu12Account, "findFirst", async () =>
    state.linked ? { userId: baseline.id, provider: "CU12" } : null);
  mock.method(prisma.cu12Account, "findUnique", async () =>
    state.linked ? { provider: "CU12", campus: "SONGSIM" } : null);
  const createAccount = mock.method(prisma.cu12Account, "create", async () => ({ provider: "CU12" }));
  const updateAccount = mock.method(prisma.cu12Account, "update", async () => ({ provider: "CU12" }));
  const policyTypes = ["PRIVACY_POLICY", "TERMS_OF_SERVICE"];
  mock.method(prisma.policyDocument, "findMany", async () => policyTypes.map(type => ({
    id: type, type, version: 1, content: "Fixture policy", templateContent: "Fixture policy",
    publishedContent: "Fixture policy", isActive: true, createdAt: new Date(), updatedAt: new Date(),
  })));
  mock.method(prisma.userPolicyConsent, "findMany", async () =>
    state.consented ? policyTypes.map(policyType => ({ policyType, policyVersion: 1 })) : []);
  return { state, createUser, approve, settingRead, settingWrite, createAccount, updateAccount };
}

function loginRequest() {
  return new NextRequest("https://cu12.test/api/auth/login", {
    method: "POST", headers: { origin: "https://cu12.test", host: "cu12.test", "content-type": "application/json" },
    body: JSON.stringify({ provider: "CU12", cu12Id: "student-fixture", cu12Password: "fixture-password" }),
  });
}

test.afterEach(async () => {
  await new Promise(resolve => setImmediate(resolve));
  mock.restoreAll();
  invalidateCachedAuthState("fixture-user");
});

test("default ON creates a pending inactive user without credentials or session cookies", async () => {
  const { state, createAccount } = fixture();
  const response = await login(loginRequest());
  assert.equal((await response.json()).stage, "APPROVAL_PENDING");
  assert.equal(state.user?.isActive, false);
  assert.equal(state.user?.approvalStatus, "PENDING");
  assert.equal(createAccount.mock.callCount(), 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("OFF automatically registers and links a USER but still requires policy consent", async () => {
  const { state, createAccount } = fixture(false);
  const response = await login(loginRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stage, "CONSENT_REQUIRED");
  assert.equal(state.user?.approvalStatus, "APPROVED");
  assert.equal(state.user?.isActive, true);
  assert.equal(state.user?.role, "USER");
  assert.equal(createAccount.mock.callCount(), 1);
  assert.equal(response.headers.get("set-cookie"), null);
});

for (const linked of [false, true]) {
  test(`OFF admits existing pending users after portal validation (linked=${linked})`, async () => {
    const { state, approve } = fixture(false);
    state.user = { ...state.baseline };
    state.linked = linked;
    const response = await login(loginRequest());
    assert.equal((await response.json()).stage, "CONSENT_REQUIRED");
    assert.equal(approve.mock.callCount(), 1);
    assert.equal(state.user?.approvalStatus, "APPROVED");
  });
}

test("OFF does not register or approve after invalid portal authentication", async () => {
  const { state, createUser, approve, settingRead } = fixture(false);
  state.validPortal = false;
  const response = await login(loginRequest());
  assert.equal(response.status, 401);
  assert.equal(createUser.mock.callCount(), 0);
  assert.equal(approve.mock.callCount(), 0);
  assert.equal(settingRead.mock.callCount(), 0);
});

for (const kind of ["rejected", "disabled", "withdrawn"] as const) {
  test(`OFF preserves ${kind} account restrictions`, async () => {
    const { state, approve, createAccount } = fixture(false);
    state.user = {
      ...state.baseline,
      approvalStatus: kind === "rejected" ? "REJECTED" : "APPROVED",
      withdrawnAt: kind === "withdrawn" ? new Date() : null,
    };
    const response = await login(loginRequest());
    assert.equal(response.status, kind === "rejected" ? 403 : 401);
    assert.equal(approve.mock.callCount(), 0);
    assert.equal(createAccount.mock.callCount(), 0);
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("switching back ON leaves approved and consented users able to log in", async () => {
  const { state } = fixture(true);
  state.user = { ...state.baseline, isActive: true, approvalStatus: "APPROVED" };
  state.consented = true;
  const response = await login(loginRequest());
  assert.equal((await response.json()).stage, "AUTHENTICATED");
  assert.match(response.headers.get("set-cookie") ?? "", /cu12_session=/);
});

test("missing AppSettings table defaults ON, unrelated storage failures propagate", async () => {
  const { settingRead } = fixture();
  settingRead.mock.mockImplementation(async () => {
    throw new Prisma.PrismaClientKnownRequestError("Missing table", { code: "P2021", clientVersion: "6.19.3" });
  });
  assert.equal(await getMemberApprovalRequired(), true);
  settingRead.mock.mockImplementation(async () => { throw new Error("Storage unavailable"); });
  await assert.rejects(getMemberApprovalRequired, /Storage unavailable/);
});

test("a concurrent rejection is re-read before account linking or issuing cookies", async () => {
  const { state, approve, createAccount } = fixture(false);
  state.user = { ...state.baseline };
  approve.mock.mockImplementation(async () => {
    state.user = { ...state.baseline, approvalStatus: "REJECTED" };
    return { count: 0 };
  });
  const response = await login(loginRequest());
  assert.equal(response.status, 403);
  assert.equal(createAccount.mock.callCount(), 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("concurrent auto-registration asks the caller to retry without issuing cookies", async () => {
  const { createUser, createAccount } = fixture(false);
  createUser.mock.mockImplementation(async () => {
    throw new Prisma.PrismaClientKnownRequestError("Duplicate user", { code: "P2002", clientVersion: "6.19.3" });
  });
  const response = await login(loginRequest());
  assert.equal(response.status, 409);
  assert.equal(createAccount.mock.callCount(), 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

async function settingsRequest(method: string, body?: unknown, role: "USER" | "ADMIN" = "ADMIN", origin = "https://cu12.test") {
  const token = await signSessionToken({ userId: "fixture-user", email: "student-fixture", role });
  const idle = await signIdleSessionToken("fixture-user");
  return new NextRequest("https://cu12.test/api/admin/settings", {
    method,
    headers: { host: "cu12.test", origin, cookie: `cu12_session=${token}; cu12_idle=${idle}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("admin can persist OFF and ON, and subsequent reads reflect the saved value", async () => {
  const { state } = fixture();
  state.user = { ...state.baseline, role: "ADMIN", isActive: true, approvalStatus: "APPROVED" };
  for (const memberApprovalRequired of [false, true]) {
    const response = await PATCH(await settingsRequest("PATCH", { memberApprovalRequired }));
    assert.equal(response.status, 200);
    assert.deepEqual(await (await GET(await settingsRequest("GET"))).json(), { memberApprovalRequired });
  }
});

test("settings reject unauthenticated, non-admin, cross-origin, and malformed changes", async () => {
  const { state, settingWrite } = fixture();
  assert.equal((await GET(new NextRequest("https://cu12.test/api/admin/settings"))).status, 403);
  state.user = { ...state.baseline, isActive: true, approvalStatus: "APPROVED" };
  assert.equal((await PATCH(await settingsRequest("PATCH", { memberApprovalRequired: false }, "USER"))).status, 403);
  state.user.role = "ADMIN";
  invalidateCachedAuthState("fixture-user");
  assert.equal((await PATCH(await settingsRequest("PATCH", { memberApprovalRequired: false }, "ADMIN", "https://other.test"))).status, 403);
  for (const body of [{}, { memberApprovalRequired: "false" }, { memberApprovalRequired: false, extra: true }]) {
    assert.equal((await PATCH(await settingsRequest("PATCH", body))).status, 400);
  }
  assert.equal(settingWrite.mock.callCount(), 0);
});

test("a failed settings write returns 503 and leaves the previous value intact", async () => {
  const { state, settingWrite } = fixture(true);
  state.user = { ...state.baseline, role: "ADMIN", isActive: true, approvalStatus: "APPROVED" };
  settingWrite.mock.mockImplementation(async () => { throw new Error("Storage unavailable"); });
  assert.equal((await PATCH(await settingsRequest("PATCH", { memberApprovalRequired: false }))).status, 503);
  assert.equal(await getMemberApprovalRequired(), true);
});
