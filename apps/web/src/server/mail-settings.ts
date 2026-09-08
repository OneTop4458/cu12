import { z } from "zod";
import { DEFAULT_MAIL_SETTINGS, DEFAULT_MAIL_TEMPLATE, MAIL_TEMPLATE_KINDS, hasEnvironmentMailConfig, publicMailSettings, validateMailTemplate, type MailTemplateKind, type StoredMailSettings } from "@cu12/core";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const singleLine = z.string().trim().max(200).refine((value) => !/[\r\n\u0000]/.test(value), "Line breaks are not allowed.");
export const MailSettingsSchema = z.object({
  enabled: z.boolean(), source: z.enum(["ENV", "CUSTOM"]),
  host: singleLine.refine((value) => !/[\s/@?#]/.test(value), "Enter a hostname without a URL scheme."),
  port: z.number().int().min(1).max(65535), tlsMode: z.enum(["STARTTLS", "TLS", "NONE"]),
  username: singleLine, fromEmail: z.union([z.literal(""), z.string().trim().email().max(200)]), fromName: singleLine,
  password: z.string().max(2000).optional(), clearPassword: z.boolean().optional(),
}).strict();

export const MailTemplateSchema = z.object({ subject: z.string(), body: z.string() }).strict()
  .superRefine((value, context) => {
    const message = validateMailTemplate(value);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  });

function invalidSettings(message: string): never {
  throw new z.ZodError([{ code: z.ZodIssueCode.custom, message, path: [] }]);
}

export function prepareMailSettings(body: z.infer<typeof MailSettingsSchema>, saved: StoredMailSettings | null) {
  const previous = saved ?? DEFAULT_MAIL_SETTINGS;
  const { password, clearPassword, ...values } = body;
  if (password && clearPassword) invalidSettings("Enter a password or clear it, not both.");
  let encryptedPassword = clearPassword ? null : previous.encryptedPassword;
  if (password) encryptedPassword = encryptSecret(password);
  const credentialsChanged = previous.host !== body.host || previous.username !== body.username;
  if (credentialsChanged && encryptedPassword && !password && !clearPassword) {
    invalidSettings("Re-enter or clear the password when changing the SMTP host or username.");
  }
  if (body.source === "CUSTOM") {
    if (!body.host || !body.fromEmail) invalidSettings("Custom SMTP requires a host and sender email.");
    if (body.enabled && body.username) {
      if (!encryptedPassword) invalidSettings("An enabled SMTP username requires a password.");
      try { if (!decryptSecret(encryptedPassword)) invalidSettings("Re-enter the SMTP password."); } catch {
        invalidSettings("Re-enter the SMTP password.");
      }
    }
  }
  return { ...values, encryptedPassword };
}

export async function getMailSettingsView() {
  const settings = await prisma.mailSettings.findUnique({ where: { id: "default" } });
  return { settings: publicMailSettings(settings), environmentConfigured: hasEnvironmentMailConfig(getEnv()) };
}

export async function getMailTemplateViews() {
  const saved = await prisma.mailTemplate.findMany({ where: { kind: { in: [...MAIL_TEMPLATE_KINDS] } } });
  return MAIL_TEMPLATE_KINDS.map((kind) => {
    const item = saved.find((value) => value.kind === kind);
    return { kind, subject: item?.subject ?? DEFAULT_MAIL_TEMPLATE.subject, body: item?.body ?? DEFAULT_MAIL_TEMPLATE.body,
      customized: Boolean(item), updatedAt: item?.updatedAt.toISOString() ?? null };
  });
}

export function isMailTemplateKind(value: string): value is MailTemplateKind {
  return MAIL_TEMPLATE_KINDS.some((kind) => kind === value);
}
