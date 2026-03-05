import nodemailer from "nodemailer";
import { getEnv } from "./env";

type SendMailResult = {
  sent: boolean;
  reason: string | null;
};

function buildSendMailReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  const code = (error as { code?: string }).code;
  const lowerMessage = error.message.toLowerCase();

  if (code === "ESOCKET") {
    return `SMTP socket error (${code})`;
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `SMTP server host DNS lookup failed (${code})`;
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET") {
    return `SMTP connection refused (${code})`;
  }
  if (code === "ETIMEDOUT" || lowerMessage.includes("timeout")) {
    return "SMTP connection timed out";
  }
  if (code === "EAUTH" || lowerMessage.includes("authentication failed") || lowerMessage.includes("invalid login")) {
    return "SMTP authentication failed";
  }

  return error.message;
}

export async function sendMail(to: string, subject: string, text: string): Promise<SendMailResult> {
  const env = getEnv();
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS || !env.SMTP_FROM) {
    return { sent: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      text,
    });

    return { sent: true, reason: null };
  } catch (error) {
    return { sent: false, reason: buildSendMailReason(error) };
  }
}
