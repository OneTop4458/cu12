import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { type PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import nodemailer from "nodemailer";
import { DEFAULT_MAIL_SETTINGS, publicMailSettings, renderMailTemplate, resolveMailTransport, safeMailError, validateMailTemplate, type StoredMailSettings } from "@cu12/core";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "mail-management-fixture".repeat(2), APP_MASTER_KEY: "mail-management-fixture".repeat(2), WORKER_SHARED_TOKEN: "mail-management-fixture".repeat(2),
  SMTP_HOST: "env.example.test", SMTP_PORT: "465", SMTP_USER: "env-user", SMTP_PASS: "env-fixture", SMTP_FROM: "env@example.test",
});
const unexpected = async () => { throw new Error("Unexpected database query in mail test"); };
globalThis.__cu12_prisma = {
  user: { findUnique: unexpected }, auditLog: { create: unexpected },
  mailSettings: { findUnique: unexpected, upsert: unexpected },
  mailTemplate: { findUnique: unexpected, findMany: unexpected, upsert: unexpected, deleteMany: unexpected },
} as unknown as PrismaClient;
const { prisma } = await import("../src/lib/prisma");
const { encryptSecret, decryptSecret } = await import("../src/lib/crypto");
const { signSessionToken, signIdleSessionToken } = await import("../src/lib/auth");
const { invalidateCachedAuthState } = await import("../src/server/auth-state-cache");
const { MailSettingsSchema, prepareMailSettings } = await import("../src/server/mail-settings");
const { sendMail, verifyMailConnection } = await import("../src/server/mail");
const { GET, PATCH } = await import("../app/api/admin/mail/settings/route");
const { PUT, DELETE } = await import("../app/api/admin/mail/templates/[kind]/route");
const { POST: verify } = await import("../app/api/admin/mail/verify/route");
const { POST: sendTest } = await import("../app/api/admin/mail/test/route");

function fixture() {
  const state = { settings: null as StoredMailSettings | null, role: "ADMIN", template: null as { subject: string; body: string } | null };
  mock.method(prisma.user, "findUnique", async () => ({ id: "mail-admin", email: "admin@example.test", role: state.role, isActive: true, approvalStatus: "APPROVED", withdrawnAt: null }));
  const audit = mock.method(prisma.auditLog, "create", async () => ({}));
  mock.method(prisma.mailSettings, "findUnique", async () => state.settings);
  const settingsWrite = mock.method(prisma.mailSettings, "upsert", async ({ update }: { update: StoredMailSettings }) => { state.settings = update; return update; });
  mock.method(prisma.mailTemplate, "findUnique", async () => state.template);
  const templateWrite = mock.method(prisma.mailTemplate, "upsert", async ({ update }: { update: { subject: string; body: string } }) => { state.template = update; return { ...update, updatedAt: new Date() }; });
  mock.method(prisma.mailTemplate, "deleteMany", async () => { state.template = null; return { count: 1 }; });
  let delivered: Record<string, unknown> | null = null;
  const smtp = { sendMail: async (message: Record<string, unknown>) => { delivered = message; }, verify: async () => true, close: () => {} };
  const connection = mock.method(nodemailer, "createTransport", () => smtp as never);
  const close = mock.method(smtp, "close");
  return { state, audit, settingsWrite, templateWrite, smtp, connection, close, get delivered() { return delivered; } };
}

async function request(method: string, body?: unknown, origin = "https://cu12.test") {
  const session = await signSessionToken({ userId: "mail-admin", email: "admin@example.test", role: "ADMIN" });
  const idle = await signIdleSessionToken("mail-admin");
  return new NextRequest("https://cu12.test/api/admin/mail/settings", { method,
    headers: { host: "cu12.test", origin, "content-type": "application/json", cookie: `cu12_session=${session}; cu12_idle=${idle}` },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

const custom = { ...DEFAULT_MAIL_SETTINGS, source: "CUSTOM", host: "smtp.example.test", username: "custom-user", fromEmail: "sender@example.test", fromName: "Fixture Sender" };
function body(overrides: Record<string, unknown> = {}) {
  const { encryptedPassword: _encryptedPassword, ...values } = custom;
  return { ...values, ...overrides };
}
test.afterEach(() => { mock.restoreAll(); invalidateCachedAuthState("mail-admin"); });

test("mail settings require admin actor and same-origin mutations", async () => {
  const f = fixture();
  assert.equal((await PATCH(new NextRequest("https://cu12.test/api/admin/mail/settings", { method: "PATCH" }))).status, 403);
  assert.equal((await PATCH(await request("PATCH", body(), "https://other.test"))).status, 403);
  f.state.role = "USER";
  assert.equal((await GET(await request("GET"))).status, 403);
  assert.equal(f.settingsWrite.mock.callCount(), 0);
});

test("settings round-trip encrypts secrets, masks reads and audit, and preserves blank password", async () => {
  const f = fixture();
  const response = await PATCH(await request("PATCH", body({ password: "private-smtp-fixture" })));
  assert.equal(response.status, 200);
  assert.equal(decryptSecret(f.state.settings!.encryptedPassword!), "private-smtp-fixture");
  const ciphertext = f.state.settings!.encryptedPassword!;
  const read = await (await GET(await request("GET"))).text();
  assert.equal(JSON.parse(read).settings.passwordConfigured, true);
  assert.ok(!read.includes(ciphertext) && !read.includes("private-smtp-fixture") && !read.includes("encryptedPassword"));
  assert.ok(!JSON.stringify(f.audit.mock.calls).includes(ciphertext));
  assert.ok(!JSON.stringify(f.audit.mock.calls).includes("private-smtp-fixture"));
  assert.equal((await PATCH(await request("PATCH", body({ password: "" })))).status, 200);
  assert.equal(f.state.settings!.encryptedPassword, ciphertext);
  assert.equal((await PATCH(await request("PATCH", body({ enabled: false, clearPassword: true })))).status, 200);
  assert.equal(f.state.settings!.encryptedPassword, null);
  assert.equal((await PATCH(await request("PATCH", body()))).status, 400);
  assert.equal(f.state.settings!.enabled, false);
});

test("custom credentials cannot silently follow a new host and malformed settings are rejected", () => {
  const saved = { ...custom, encryptedPassword: encryptSecret("existing-fixture") };
  assert.throws(() => prepareMailSettings(MailSettingsSchema.parse(body({ host: "different.example.test" })), saved));
  assert.throws(() => MailSettingsSchema.parse(body({ fromName: "Sender\r\nBcc: another@example.test" })));
  assert.throws(() => MailSettingsSchema.parse(body({ port: 0 })));
  assert.throws(() => MailSettingsSchema.parse(body({ password: "fixture", encryptedPassword: "not-allowed" })));
});

test("ENV preserves legacy TLS, CUSTOM never borrows env fields or credentials, OFF disables both", () => {
  const env = { SMTP_HOST: "env.example.test", SMTP_PORT: 465, SMTP_USER: "env-user", SMTP_PASS: "env-fixture", SMTP_FROM: "env@example.test" };
  assert.equal(resolveMailTransport(null, env, decryptSecret).config?.options.secure, true);
  assert.equal(resolveMailTransport(custom, env, decryptSecret).reason, "SMTP_PASSWORD_REQUIRED");
  const resolved = resolveMailTransport({ ...custom, encryptedPassword: encryptSecret("custom-fixture") }, env, decryptSecret);
  assert.equal(resolved.config?.options.host, "smtp.example.test");
  assert.equal(resolved.config?.options.auth?.pass, "custom-fixture");
  assert.equal(resolveMailTransport({ ...custom, host: "" }, env, decryptSecret).config, null);
  assert.equal(resolveMailTransport({ ...custom, encryptedPassword: "broken" }, env, decryptSecret).reason, "SMTP_PASSWORD_UNAVAILABLE");
  assert.equal(resolveMailTransport({ ...custom, enabled: false }, env, decryptSecret).reason, "MAIL_DISABLED");
  assert.equal(resolveMailTransport({ ...DEFAULT_MAIL_SETTINGS, enabled: false }, env, decryptSecret).reason, "MAIL_DISABLED");
  assert.ok(!("encryptedPassword" in publicMailSettings(custom)));
});

test("templates require original details once, reject header injection, and escape template HTML", () => {
  for (const value of ["no details", "{{content}} {{content}}", "{{unknown}} {{content}}", "{{content}} {{unclosed"]) assert.ok(validateMailTemplate({ subject: "Subject", body: value }));
  assert.ok(validateMailTemplate({ subject: "Subject\r\nBcc: other@example.test", body: "{{content}}" }));
  assert.ok(validateMailTemplate({ subject: "{{content}}", body: "{{content}}" }));
  const html = '<html><body><p>Operational details &amp; link</p></body></html>';
  const result = renderMailTemplate({ subject: "Prefix {{subject}}", body: "<script>bad()</script>\n{{recipient}}\n{{content}}\nEnd" }, { subject: "Original", recipient: "<recipient>", date: "fixture date", html });
  assert.equal(result.subject, "Prefix Original");
  assert.ok(result.html!.includes("&lt;script&gt;bad()&lt;/script&gt;") && result.html!.includes("&lt;recipient&gt;"));
  assert.equal((result.html!.match(/<html>/g) ?? []).length, 1);
  assert.ok(result.html!.startsWith("<html><body>&lt;script&gt;") && result.html!.endsWith("End</body></html>"));
  assert.ok(result.html!.includes("<p>Operational details &amp; link</p>"));
  assert.equal(renderMailTemplate(null, { subject: "Original", recipient: "fixture", date: "fixture", html }).html, html);
});

test("template API saves and resets, and rejects invalid content without writing", async () => {
  const f = fixture(); const params = { params: Promise.resolve({ kind: "TEST" }) };
  assert.equal((await PUT(await request("PUT", { subject: "Hi", body: "Missing details" }), params)).status, 400);
  assert.equal(f.templateWrite.mock.callCount(), 0);
  assert.equal((await PUT(await request("PUT", { subject: "Hi {{subject}}", body: "Intro\n{{content}}" }), params)).status, 200);
  const reset = await DELETE(await request("DELETE", {}), params);
  assert.equal(reset.status, 200); assert.equal((await reset.json()).customized, false); assert.equal(f.state.template, null);
  assert.equal((await PUT(await request("PUT", {}), { params: Promise.resolve({ kind: "DIGEST" }) })).status, 404);
});

test("web sending and verification use saved settings/templates and close mocked transports", async () => {
  const f = fixture(); f.state.settings = { ...custom, encryptedPassword: encryptSecret("saved-fixture") };
  f.state.template = { subject: "Configured {{subject}}", body: "Intro\n{{content}}" };
  const result = await sendMail("recipient@example.test", "Subject", "Generated details");
  assert.equal(result.subject, "Configured Subject"); assert.equal(result.sent, true);
  assert.equal(f.delivered?.text, "Intro\nGenerated details");
  assert.deepEqual(f.delivered?.from, { name: "Fixture Sender", address: "sender@example.test" });
  const options = f.connection.mock.calls[0]!.arguments[0] as unknown as { host: string; socketTimeout: number; requireTLS: boolean };
  assert.equal(options.host, "smtp.example.test"); assert.equal(options.requireTLS, true); assert.equal(options.socketTimeout, 20000);
  assert.equal((await verifyMailConnection()).verified, true); assert.equal(f.close.mock.callCount(), 2);
  mock.method(f.smtp, "sendMail", async () => { throw Object.assign(new Error("private-server-response"), { code: "EAUTH" }); });
  assert.equal((await sendMail("recipient@example.test", "Subject", "Details")).reason, "SMTP authentication failed");
  assert.equal(f.close.mock.callCount(), 3);
  assert.equal(safeMailError(new Error("private-server-response")), "SMTP operation failed");
});

test("disabled and unavailable storage never start SMTP; verify does not send and test requires recipient", async () => {
  const f = fixture(); f.state.settings = { ...DEFAULT_MAIL_SETTINGS, enabled: false };
  assert.equal((await sendMail("recipient@example.test", "Subject", "Details")).reason, "MAIL_DISABLED");
  assert.equal((await verify(await request("POST", {}))).status, 503);
  assert.equal(f.connection.mock.callCount(), 0);
  f.state.settings = null;
  assert.equal((await verify(await request("POST", {}))).status, 200);
  assert.equal(f.delivered, null);
  assert.equal((await sendTest(await request("POST", { to: "bad" }))).status, 400);
  assert.equal((await sendTest(await request("POST", { to: "recipient@example.test" }))).status, 200);
  assert.equal((f.delivered as Record<string, unknown> | null)?.to, "recipient@example.test");
  mock.method(prisma.mailSettings, "findUnique", async () => { throw new Error("private-database-response"); });
  const before = f.connection.mock.callCount();
  assert.equal((await sendMail("recipient@example.test", "Subject", "Details")).sent, false);
  assert.equal(f.connection.mock.callCount(), before);
});
