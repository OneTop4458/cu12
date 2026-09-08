import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { sendMail } from "@/server/mail";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  try {
    const { to } = await parseBody(request, z.object({ to: z.string().trim().email().max(200) }).strict());
    const result = await sendMail(to, "[CU12] 메일 발송 테스트", "CU12 관리자 메일 설정에서 요청한 테스트 메일입니다.", "TEST");
    await writeAuditLogBestEffort({ category: "MAIL", severity: result.sent ? "INFO" : "WARN", actorUserId: context.actor.userId,
      message: "Admin sent configuration test mail", meta: { to, sent: result.sent, reason: result.reason } });
    return jsonOk({ to, sent: result.sent, reason: result.reason }, { status: result.sent ? 200 : 503 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("Enter one valid recipient email.", 400, "VALIDATION_ERROR");
    return jsonError("Failed to send test mail.", 503);
  }
}
