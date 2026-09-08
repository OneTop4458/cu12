import assert from "node:assert/strict";
import test, { mock } from "node:test";
import nodemailer from "nodemailer";
import { DEFAULT_MAIL_SETTINGS } from "@cu12/core";
import { prisma } from "./prisma";
import { sendMail } from "./mail";
import { encryptSecret } from "./secret";

Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@localhost:5432/test", APP_MASTER_KEY: "mail-worker-fixture".repeat(2), WORKER_SHARED_TOKEN: "mail-worker-fixture".repeat(2),
  SMTP_HOST: "env.example.test", SMTP_PORT: "465", SMTP_USER: "env-user", SMTP_PASS: "env-fixture", SMTP_FROM: "env@example.test",
});
// Prisma delegates expose synthetic descriptors, so install tracked read functions directly.
function readMock(delegate: object, replacement: (args: unknown) => Promise<unknown>) {
  const tracked = mock.fn(replacement);
  Object.defineProperty(delegate, "findUnique", { configurable: true, writable: true, value: tracked });
  return tracked;
}
test.afterEach(() => mock.restoreAll());

test("worker reads saved SMTP and kind-specific template while preserving generated HTML", async () => {
  readMock(prisma.mailSettings, async () => ({ ...DEFAULT_MAIL_SETTINGS, source: "CUSTOM", host: "saved.example.test", username: "saved-user", encryptedPassword: encryptSecret("saved-fixture"), fromEmail: "sender@example.test", fromName: "Sender" }));
  const templateRead = readMock(prisma.mailTemplate, async () => ({ subject: "Saved {{subject}}", body: "Intro\n{{content}}\nEnd" }));
  let message: Record<string, unknown> | undefined;
  const transport = { sendMail: async (value: Record<string, unknown>) => { message = value; }, close: () => {} };
  const connection = mock.method(nodemailer, "createTransport", () => transport as never);
  const close = mock.method(transport, "close");
  const result = await sendMail("member@example.test", "Deadline", "<p>Preserved details</p>", "DEADLINE");
  assert.equal(result.sent, true); assert.equal(result.subject, "Saved Deadline");
  assert.deepEqual(templateRead.mock.calls[0]!.arguments[0], { where: { kind: "DEADLINE" } });
  assert.equal(message?.html, "Intro<br><p>Preserved details</p><br>End");
  const options = connection.mock.calls[0]!.arguments[0] as unknown as { host: string; auth: { pass: string } };
  assert.equal(options.host, "saved.example.test"); assert.equal(options.auth.pass, "saved-fixture");
  assert.equal(close.mock.callCount(), 1);
});

test("worker default content stays unchanged and SMTP failures are sanitized and closed", async () => {
  readMock(prisma.mailSettings, async () => null);
  readMock(prisma.mailTemplate, async () => null);
  const send = mock.fn(async () => {});
  const close = mock.fn();
  mock.method(nodemailer, "createTransport", () => ({ sendMail: send, close }) as never);
  assert.equal((await sendMail("member@example.test", "Default", "<p>Default</p>", "POLICY_UPDATE")).sent, true);
  const sent = send.mock.calls[0]!.arguments as unknown as [{ html: string; subject: string }];
  assert.equal(sent[0].html, "<p>Default</p>"); assert.equal(sent[0].subject, "Default");
  send.mock.mockImplementation(async () => { throw Object.assign(new Error("private-response"), { code: "EAUTH" }); });
  assert.equal((await sendMail("member@example.test", "Default", "Details", "TEST")).reason, "SMTP authentication failed");
  assert.equal(close.mock.callCount(), 2);
});

test("worker cannot bypass saved OFF or storage errors through environment fallback", async () => {
  readMock(prisma.mailSettings, async () => ({ ...DEFAULT_MAIL_SETTINGS, enabled: false }));
  readMock(prisma.mailTemplate, async () => null);
  const connection = mock.method(nodemailer, "createTransport", () => { throw new Error("SMTP must not start"); });
  assert.equal((await sendMail("member@example.test", "Subject", "Body", "TEST")).reason, "MAIL_DISABLED");
  readMock(prisma.mailSettings, async () => { throw new Error("private-database-response"); });
  assert.equal((await sendMail("member@example.test", "Subject", "Body", "TEST")).reason, "SMTP operation failed");
  assert.equal(connection.mock.callCount(), 0);
});
