import nodemailer from "nodemailer";
import { getEnv } from "@/lib/env";

type SendMailResult = {
  sent: boolean;
  reason: string | null;
};

export async function sendMail(
  to: string,
  subject: string,
  text: string,
): Promise<SendMailResult> {
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
    const reason = error instanceof Error && error.message ? error.message : "Unknown error";
    return {
      sent: false,
      reason: `Failed to send test mail: ${reason}`,
    };
  }
}
