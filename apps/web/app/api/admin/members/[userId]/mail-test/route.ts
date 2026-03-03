import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { AuditCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/server/mail";
import { writeAuditLog } from "@/server/audit-log";

const BodySchema = z.object({
  to: z.string().email().max(200).optional(),
  subject: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().max(3000).optional(),
});

interface Params {
  params: Promise<{ userId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;
    const body = await parseBody(request, BodySchema);

    const [user, subscription] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          isActive: true,
        },
      }),
      prisma.mailSubscription.findUnique({
        where: { userId },
        select: { email: true, enabled: true },
      }),
    ]);

    if (!user) {
      return jsonError("User not found", 404);
    }

    if (!user.isActive) {
      return jsonError("Cannot send test mail to inactive member", 409, "MEMBER_INACTIVE");
    }

    const to = body.to?.trim() || subscription?.email || user.email;
    const resolvedSubject = body.subject?.trim() || "[CU12] Mail Delivery Test";
    const resolvedMessage = body.message?.trim()
      || [
        "This is a CU12 mail delivery test message.",
        "",
        `Recipient: ${user.email}`,
        `Name: ${user.name}`,
        `Target mailbox: ${to}`,
        `Subscription status: ${subscription?.enabled === false ? "OFF" : "ON"}`,
        `Sent at: ${new Date().toLocaleString("ko-KR")}`,
      ].join("\n");

    const result = await sendMail(to, resolvedSubject, resolvedMessage);

    await prisma.mailDelivery.create({
      data: {
        userId,
        toEmail: to,
        subject: resolvedSubject,
        status: result.sent ? "SENT" : "SKIPPED",
        error: result.sent ? null : result.reason,
        sentAt: result.sent ? new Date() : null,
      },
    });

    if (!result.sent) {
      const reason = result.reason === "SMTP_NOT_CONFIGURED"
        ? "SMTP 설정이 누락되어 테스트 메일을 보낼 수 없습니다."
        : result.reason;
      await writeAuditLog({
        category: AuditCategory.MAIL,
        actorUserId: context.actor.userId,
        targetUserId: userId,
        message: "Admin test mail skipped",
        severity: "WARN",
        meta: {
          to,
          subject: resolvedSubject,
          reason,
          userId,
        },
      });
      return jsonError(reason ?? "SMTP settings are not configured", 400, "MAIL_NOT_SENT");
    }

    await writeAuditLog({
      category: AuditCategory.MAIL,
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "Admin sent test mail",
      meta: {
        to,
        subject: resolvedSubject,
        userId,
      },
    });

    return jsonOk({ sent: true, to, reason: null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError(
      error instanceof Error ? error.message : "메일 테스트 발송에 실패했습니다.",
      500,
      "MAIL_TEST_FAILED",
    );
  }
}
