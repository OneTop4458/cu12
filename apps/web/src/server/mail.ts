import nodemailer from "nodemailer";
import { renderMailTemplate, resolveMailTransport, safeMailError, type MailTemplateKind } from "@cu12/core";
import { decryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function verifyMailConnection(): Promise<{ verified: boolean; reason: string | null }> {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const settings = await prisma.mailSettings.findUnique({ where: { id: "default" } });
    const resolved = resolveMailTransport(settings, getEnv(), decryptSecret);
    if (!resolved.config) return { verified: false, reason: resolved.reason };
    transport = nodemailer.createTransport(resolved.config.options);
    await transport.verify();
    return { verified: true, reason: null };
  } catch (error) {
    return { verified: false, reason: safeMailError(error) };
  } finally {
    transport?.close();
  }
}

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  kind: MailTemplateKind = "TEST",
) {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const [settings, template] = await Promise.all([
      prisma.mailSettings.findUnique({ where: { id: "default" } }),
      prisma.mailTemplate.findUnique({ where: { kind } }),
    ]);
    const resolved = resolveMailTransport(settings, getEnv(), decryptSecret);
    if (!resolved.config) return { sent: false, reason: resolved.reason, subject };
    const message = renderMailTemplate(template, { subject, text, recipient: to, date: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) });
    transport = nodemailer.createTransport(resolved.config.options);
    await transport.sendMail({ from: resolved.config.from, to, ...message });
    return { sent: true, reason: null, subject: message.subject };
  } catch (error) {
    return { sent: false, reason: safeMailError(error), subject };
  } finally {
    transport?.close();
  }
}
