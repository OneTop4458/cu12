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

const unexpectedQuery = async () => { throw new Error("Unexpected database query in member edit test"); };
globalThis.__cu12_prisma = {
  user: { findUnique: unexpectedQuery, updateMany: unexpectedQuery },
  cu12Account: { updateMany: unexpectedQuery },
  mailSubscription: { upsert: unexpectedQuery },
  auditLog: { create: unexpectedQuery },
  $transaction: unexpectedQuery,
} as unknown as PrismaClient;
const { prisma } = await import("../src/lib/prisma");
const { PATCH } = await import("../app/api/admin/members/[userId]/route");
const { signSessionToken, signIdleSessionToken, verifyPassword } = await import("../src/lib/auth");
const { getCachedActiveUser, invalidateCachedAuthState } = await import("../src/server/auth-state-cache");

function project(record: Record<string, unknown> | null, select?: Record<string, unknown> | null): unknown {
  if (!record || !select) return record;
  return Object.fromEntries(Object.entries(select).filter(([, value]) => value).map(([key, value]) => {
    const field = record[key];
    if (value === true) return [key, field];
    const nested = (value as { select: Record<string, unknown> }).select;
    return [key, Array.isArray(field)
      ? field.map((entry) => project(entry, nested))
      : project(field as Record<string, unknown> | null, nested)];
  }));
}

const mailPreference = {
  email: "member-fixture@example.test", enabled: true, alertOnDeadline: true, alertOnAutolearn: false,
};

function fixture() {
  const member = {
    id: "member-fixture", email: "portal-fixture", name: "Fixture Member", passwordHash: "existing-hash",
    role: "USER" as "ADMIN" | "USER", isActive: true, isTestUser: false,
    approvalStatus: "APPROVED" as "PENDING" | "APPROVED" | "REJECTED", withdrawnAt: null as Date | null,
    approvalRequestedAt: null, approvalDecidedAt: null, approvalDecidedByUserId: null, approvalRejectedReason: null,
  };
  const account = {
    id: "account-fixture", userId: member.id, cu12Id: "portal-fixture", campus: "SONGSIM",
    accountStatus: "CONNECTED", statusReason: null, encryptedPassword: "private-portal-fixture",
    autoLearnEnabled: true, quizAutoSolveEnabled: true, detectActivitiesEnabled: true, emailDigestEnabled: true,
  };
  const subscription = {
    ...mailPreference, alertOnNotice: false, digestEnabled: false, digestHour: 8, updatedAt: new Date(),
  };
  const state = {
    actor: { ...member, id: "admin-fixture", role: "ADMIN" as "ADMIN" | "USER" },
    member: { ...member } as typeof member | null,
    account: { ...account } as typeof account | null,
    subscription: null as typeof subscription | null,
    failMail: false, memberChanged: false, accountDisappeared: false,
  };
  const userWrites: Prisma.UserUpdateManyArgs[] = [];
  const accountWrites: Prisma.Cu12AccountUpdateManyArgs[] = [];
  const mailWrites: Prisma.MailSubscriptionUpsertArgs[] = [];
  const lookup = mock.method(prisma.user, "findUnique", async ({ where, select }: Prisma.UserFindUniqueArgs) => {
    const record = where.id === state.actor.id ? state.actor : state.member;
    return project(record ? { ...record, cu12Account: state.account } : null, select);
  });
  const audit = mock.method(prisma.auditLog, "create", async () => ({}));
  const transaction = mock.method(prisma, "$transaction", async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const draft = structuredClone({ member: state.member!, account: state.account, subscription: state.subscription });
    const tx = {
      user: {
        updateMany: async (args: Prisma.UserUpdateManyArgs) => {
          userWrites.push(args);
          assert.equal(args.where?.withdrawnAt, null);
          assert.equal(args.where?.approvalStatus, draft.member.approvalStatus);
          assert.equal(args.where?.isTestUser, draft.member.isTestUser);
          if (state.memberChanged) return { count: 0 };
          Object.assign(draft.member, args.data);
          return { count: 1 };
        },
        findUniqueOrThrow: async ({ select }: Prisma.UserFindUniqueOrThrowArgs) => project({
          ...draft.member, cu12Account: draft.account, mailSubs: draft.subscription ? [draft.subscription] : [],
        }, select),
      },
      cu12Account: {
        updateMany: async (args: Prisma.Cu12AccountUpdateManyArgs) => {
          accountWrites.push(args);
          if (!draft.account || state.accountDisappeared) return { count: 0 };
          Object.assign(draft.account, Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)));
          return { count: 1 };
        },
      },
      mailSubscription: {
        upsert: async (args: Prisma.MailSubscriptionUpsertArgs) => {
          mailWrites.push(args);
          if (state.failMail) throw new Error("Mail storage unavailable");
          draft.subscription = { ...subscription, ...draft.subscription, ...(draft.subscription ? args.update : args.create) } as typeof subscription;
          return draft.subscription;
        },
      },
    } as unknown as Prisma.TransactionClient;
    const result = await work(tx);
    state.member = draft.member;
    state.account = draft.account;
    state.subscription = draft.subscription;
    return result;
  });
  return { state, lookup, transaction, audit, userWrites, accountWrites, mailWrites };
}

async function request(body: unknown, options: { role?: "ADMIN" | "USER"; origin?: string; raw?: boolean } = {}) {
  const token = await signSessionToken({ userId: "admin-fixture", email: "admin-fixture", role: options.role ?? "ADMIN" });
  const idle = await signIdleSessionToken("admin-fixture");
  return new NextRequest("https://cu12.test/api/admin/members/member-fixture", {
    method: "PATCH",
    headers: {
      host: "cu12.test", origin: options.origin ?? "https://cu12.test", "content-type": "application/json",
      cookie: `cu12_session=${token}; cu12_idle=${idle}`,
    },
    body: options.raw ? String(body) : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ userId: "member-fixture" }) };
test.afterEach(() => {
  mock.restoreAll();
  invalidateCachedAuthState("admin-fixture");
  invalidateCachedAuthState("member-fixture");
});

test("member edit requires an active administrator and a same-origin request", async () => {
  const { state, transaction } = fixture();
  assert.equal((await PATCH(new NextRequest("https://cu12.test/api/admin/members/member-fixture", { method: "PATCH" }), params)).status, 403);
  state.actor.role = "USER";
  assert.equal((await PATCH(await request({ name: "Changed" }, { role: "USER" }), params)).status, 403);
  state.actor.role = "ADMIN";
  state.actor.isActive = false;
  invalidateCachedAuthState(state.actor.id);
  assert.equal((await PATCH(await request({ name: "Changed" }), params)).status, 403);
  state.actor.isActive = true;
  invalidateCachedAuthState(state.actor.id);
  assert.equal((await PATCH(await request({ name: "Changed" }, { origin: "https://other.test" }), params)).status, 403);
  assert.equal(transaction.mock.callCount(), 0);
});

test("invalid or incomplete edits are rejected before transaction writes", async () => {
  const { transaction } = fixture();
  for (const body of [
    {}, { name: " " }, { campus: "UNKNOWN" }, { isActive: "true" }, { localPassword: "short" },
    { localPassword: "x".repeat(121) }, { mailPreference: { email: "member@example.test" } },
    { mailPreference: { ...mailPreference, email: "not-an-email" } },
    { mailPreference: { ...mailPreference, digestEnabled: true } }, { unknown: true },
  ]) {
    const response = await PATCH(await request(body), params);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).errorCode, "VALIDATION_ERROR");
  }
  assert.equal((await PATCH(await request("{", { raw: true }), params)).status, 400);
  assert.equal(transaction.mock.callCount(), 0);
});

test("profile, campus, automation, and mail preferences commit together with redacted audit metadata", async () => {
  const { state, transaction, audit, userWrites, accountWrites, mailWrites } = fixture();
  const response = await PATCH(await request({
    name: "Edited Fixture", role: "ADMIN", campus: "SONGSIN", autoLearnEnabled: false,
    quizAutoSolveEnabled: false, detectActivitiesEnabled: false, emailDigestEnabled: true,
    mailPreference: { ...mailPreference, email: ` ${mailPreference.email} ` },
  }), params);
  assert.equal(response.status, 200);
  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(userWrites.length, 1);
  assert.equal(accountWrites.length, 1);
  assert.equal(mailWrites.length, 1);
  assert.equal(state.member?.name, "Edited Fixture");
  assert.equal(state.member?.role, "ADMIN");
  assert.equal(state.account?.campus, "SONGSIN");
  assert.equal(state.account?.autoLearnEnabled, false);
  assert.equal(state.account?.quizAutoSolveEnabled, false);
  assert.equal(state.account?.detectActivitiesEnabled, false);
  assert.equal(state.account?.emailDigestEnabled, false);
  assert.equal(state.subscription?.email, mailPreference.email);
  assert.equal(state.subscription?.digestEnabled, false);
  assert.equal(state.subscription?.alertOnNotice, false);
  const payload = await response.json();
  assert.equal(payload.updated, true);
  assert.equal(payload.user.mailPreference.alertOnAutolearn, false);
  assert.equal("mailSubs" in payload.user, false);
  assert.equal("passwordHash" in payload.user, false);
  assert.equal("encryptedPassword" in payload.user.cu12Account, false);
  const auditJson = JSON.stringify(audit.mock.calls[0].arguments);
  assert.equal(auditJson.includes(mailPreference.email), false);
  assert.equal(auditJson.includes("Edited Fixture"), false);
  assert.match(auditJson, /updatedFields/);
});

test("mail storage failure rolls back profile and account changes", async () => {
  const { state, audit } = fixture();
  state.failMail = true;
  const before = structuredClone(state);
  const response = await PATCH(await request({ name: "Must Roll Back", campus: "SONGSIN", mailPreference }), params);
  assert.equal(response.status, 500);
  assert.deepEqual(state.member, before.member);
  assert.deepEqual(state.account, before.account);
  assert.equal(state.subscription, null);
  assert.equal(audit.mock.callCount(), 0);
});

test("editing an existing mail preference preserves its hour and disables dormant channels", async () => {
  const { state } = fixture();
  state.subscription = { ...mailPreference, alertOnNotice: true, digestEnabled: true, digestHour: 14, updatedAt: new Date() };
  const response = await PATCH(await request({ mailPreference: { ...mailPreference, enabled: false, alertOnDeadline: false } }), params);
  assert.equal(response.status, 200);
  assert.equal(state.subscription?.enabled, false);
  assert.equal(state.subscription?.alertOnDeadline, false);
  assert.equal(state.subscription?.alertOnNotice, false);
  assert.equal(state.subscription?.digestEnabled, false);
  assert.equal(state.subscription?.digestHour, 14);
});

test("member role and activation edits invalidate cached authorization", async () => {
  fixture();
  assert.equal((await getCachedActiveUser("member-fixture"))?.role, "USER");
  assert.equal((await PATCH(await request({ role: "ADMIN" }), params)).status, 200);
  assert.equal((await getCachedActiveUser("member-fixture"))?.role, "ADMIN");
  assert.equal((await PATCH(await request({ isActive: false }), params)).status, 200);
  assert.equal(await getCachedActiveUser("member-fixture"), null);
});

test("missing portal links reject account edits without saving profile or mail", async () => {
  const { state, transaction } = fixture();
  state.account = null;
  for (const accountField of [{ campus: "SONGSIN" }, { autoLearnEnabled: false }, { accountStatus: "ERROR" }, { emailDigestEnabled: false }]) {
    const response = await PATCH(await request({ name: "Unchanged", ...accountField, mailPreference }), params);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).errorCode, "MEMBER_ACCOUNT_REQUIRED");
  }
  assert.equal(transaction.mock.callCount(), 0);
  assert.equal(state.member?.name, "Fixture Member");
});

test("unlinked members can still change profile and mail settings", async () => {
  const { state } = fixture();
  state.account = null;
  assert.equal((await PATCH(await request({ name: "Unlinked Member", mailPreference }), params)).status, 200);
  assert.equal(state.member?.name, "Unlinked Member");
  assert.equal(state.subscription?.enabled, true);
});

test("a portal link disappearing during the save rolls back all member edits", async () => {
  const { state, audit } = fixture();
  state.accountDisappeared = true;
  const response = await PATCH(await request({ name: "Unchanged", campus: "SONGSIN", mailPreference }), params);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, "MEMBER_ACCOUNT_REQUIRED");
  assert.equal(state.member?.name, "Fixture Member");
  assert.equal(state.subscription, null);
  assert.equal(audit.mock.callCount(), 0);
});

test("a concurrent member state change is rejected before account or mail writes", async () => {
  const { state, accountWrites, mailWrites, audit } = fixture();
  state.memberChanged = true;
  const response = await PATCH(await request({ isActive: true, mailPreference }), params);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, "MEMBER_CHANGED");
  assert.equal(accountWrites.length, 0);
  assert.equal(mailWrites.length, 0);
  assert.equal(audit.mock.callCount(), 0);
});

test("self-demotion and self-deactivation are rejected", async () => {
  const { transaction } = fixture();
  const ownParams = { params: Promise.resolve({ userId: "admin-fixture" }) };
  for (const body of [{ role: "USER" }, { isActive: false }]) {
    assert.equal((await PATCH(await request(body), ownParams)).status, 400);
  }
  assert.equal(transaction.mock.callCount(), 0);
});

test("self account-type changes are rejected while retaining the current type is allowed", async () => {
  const { state, transaction } = fixture();
  const ownParams = { params: Promise.resolve({ userId: "admin-fixture" }) };
  for (const isTestUser of [false, true]) {
    state.actor.isTestUser = isTestUser;
    const response = await PATCH(await request({ isTestUser: !isTestUser }), ownParams);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "OWN_ACCOUNT_TYPE_CHANGE_NOT_ALLOWED");
  }
  assert.equal(transaction.mock.callCount(), 0);
  state.member = { ...state.actor };
  assert.equal((await PATCH(await request({ isTestUser: true, name: "Same Type" }), ownParams)).status, 200);
  assert.equal(state.member.isTestUser, true);
  assert.equal(state.member.name, "Same Type");
});

test("withdrawn members cannot be edited and pending or rejected members cannot be activated", async () => {
  const { state, transaction } = fixture();
  state.member!.withdrawnAt = new Date();
  let response = await PATCH(await request({ name: "Unchanged" }), params);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, "MEMBER_WITHDRAWN");
  state.member!.withdrawnAt = null;
  for (const approvalStatus of ["PENDING", "REJECTED"] as const) {
    state.member!.approvalStatus = approvalStatus;
    response = await PATCH(await request({ isActive: true }), params);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).errorCode, "MEMBER_APPROVAL_REQUIRED");
  }
  state.member = null;
  assert.equal((await PATCH(await request({ name: "Missing" }), params)).status, 404);
  assert.equal(transaction.mock.callCount(), 0);
});

test("editing an inactive member does not implicitly activate or approve the account", async () => {
  const { state } = fixture();
  state.member!.isActive = false;
  state.member!.approvalStatus = "PENDING";
  assert.equal((await PATCH(await request({ name: "Pending Fixture", mailPreference }), params)).status, 200);
  assert.equal(state.member?.isActive, false);
  assert.equal(state.member?.approvalStatus, "PENDING");
});

test("real-to-test conversion requires a new valid local password and never audits its value", async () => {
  const { state, transaction, audit } = fixture();
  for (const localPassword of [undefined, "", "        "]) {
    const response = await PATCH(await request({ isTestUser: true, localPassword }), params);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, "LOCAL_PASSWORD_REQUIRED");
  }
  assert.equal(transaction.mock.callCount(), 0);
  const localPassword = "new-fixture-password";
  const response = await PATCH(await request({ isTestUser: true, localPassword }), params);
  assert.equal(response.status, 200);
  assert.equal(state.member?.isTestUser, true);
  assert.equal(await verifyPassword(localPassword, state.member!.passwordHash), true);
  const auditJson = JSON.stringify(audit.mock.calls[0].arguments);
  assert.equal(auditJson.includes(localPassword), false);
  assert.equal(auditJson.includes(state.member!.passwordHash), false);
  assert.match(auditJson, /"localPasswordUpdated":true/);
});

test("existing test-user edits preserve omitted or blank passwords, while real users reject a local password", async () => {
  const { state } = fixture();
  state.member!.isTestUser = true;
  for (const localPassword of [undefined, "", "   "]) {
    assert.equal((await PATCH(await request({ name: "Test Fixture", localPassword }), params)).status, 200);
    assert.equal(state.member?.passwordHash, "existing-hash");
  }
  assert.equal((await PATCH(await request({ isTestUser: false }), params)).status, 200);
  const response = await PATCH(await request({ localPassword: "new-fixture-password" }), params);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).errorCode, "LOCAL_PASSWORD_NOT_ALLOWED");
  assert.equal(state.member?.passwordHash, "existing-hash");
});

test("legacy account fields remain available without enabling subscription digest or notice delivery", async () => {
  const { state, mailWrites } = fixture();
  const response = await PATCH(await request({ emailDigestEnabled: true, accountStatus: "NEEDS_REAUTH", statusReason: null }), params);
  assert.equal(response.status, 200);
  assert.equal(state.account?.emailDigestEnabled, true);
  assert.equal(state.account?.accountStatus, "NEEDS_REAUTH");
  assert.equal(state.subscription, null);
  assert.equal(mailWrites.length, 0);
});
