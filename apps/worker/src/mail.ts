import nodemailer from "nodemailer";
import { renderMailTemplate, resolveMailTransport, safeMailError, type MailTemplateKind } from "@cu12/core";
import { getEnv } from "./env";
import { prisma } from "./prisma";
import { decryptSecret } from "./secret";

export async function sendMail(to: string, subject: string, html: string, kind?: MailTemplateKind) {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  try {
    const [settings, template] = await Promise.all([
      prisma.mailSettings.findUnique({ where: { id: "default" } }),
      kind ? prisma.mailTemplate.findUnique({ where: { kind } }) : Promise.resolve(null),
    ]);
    const resolved = resolveMailTransport(settings, getEnv(), decryptSecret);
    if (!resolved.config) return { sent: false, reason: resolved.reason, subject };
    const message = renderMailTemplate(template, { subject, html, recipient: to, date: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) });
    transport = nodemailer.createTransport(resolved.config.options);
    await transport.sendMail({ from: resolved.config.from, to, ...message });
    return { sent: true, reason: null, subject: message.subject };
  } catch (error) {
    return { sent: false, reason: safeMailError(error), subject };
  } finally {
    transport?.close();
  }
}
