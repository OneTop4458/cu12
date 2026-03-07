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

  const normalizeReason = (reason: string | null | undefined) => {
    if (!reason) {
      return "메일 테스트 발송을 완료할 수 없습니다.";
    }
    if (reason === "SMTP_NOT_CONFIGURED") {
      return "SMTP 설정이 누락되어 테스트 메일을 보낼 수 없습니다.";
    }
    if (reason.includes("SMTP connection timed out")) {
      return "SMTP 서버 연결이 시간 초과되어 테스트 메일을 보낼 수 없습니다.";
    }
    if (reason.includes("SMTP server connection refused")) {
      return "SMTP 서버 연결이 거부되었습니다.";
    }
    if (reason.includes("SMTP authentication failed")) {
      return "SMTP 인증에 실패했습니다. SMTP 계정 정보(아이디/비밀번호) 확인이 필요합니다.";
    }
    if (reason.includes("SMTP server host DNS lookup failed")) {
      return "SMTP 서버 주소(DNS)를 확인할 수 없습니다.";
    }
    if (reason.includes("SMTP socket error")) {
      return "SMTP 소켓 오류로 테스트 메일을 발송하지 못했습니다.";
    }
    if (reason === "Failed to send test mail" || reason.startsWith("Failed to send test mail:")) {
      return "메일 테스트 발송에 실패했습니다.";
    }
    if (reason.includes("ENOTFOUND")) {
      return "SMTP 서버 주소를 확인할 수 없습니다.";
    }
    if (reason.includes("ECONNREFUSED")) {
      return "SMTP 서버에 연결할 수 없습니다.";
    }
    return reason;
  };

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
      return jsonError("비활성 회원에는 테스트 메일을 발송할 수 없습니다.", 409, "MEMBER_INACTIVE");
    }

    const to = body.to?.trim() || subscription?.email || user.email;
    const resolvedSubject = body.subject?.trim() || "[CU12] 메일 발송 테스트";
    const resolvedMessage = body.message?.trim()
      || [
        "CU12 메일 발송 테스트 메시지입니다.",
        "",
        `회원 이메일: ${user.email}`,
        `이름: ${user.name ?? "-"}`,
        `수신 대상 메일함: ${to}`,
        `수신 설정 상태: ${subscription?.enabled === false ? "비활성" : "활성"}`,
        `발송 시각: ${new Date().toLocaleString("ko-KR")}`,
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
      const reason = normalizeReason(result.reason);
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
      return jsonError(reason, 400, "MAIL_NOT_SENT");
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
