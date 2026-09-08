import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { verifyMailConnection } from "@/server/mail";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);
  try {
    await parseBody(request, z.object({}).strict());
    const result = await verifyMailConnection();
    await writeAuditLogBestEffort({ category: "MAIL", severity: result.verified ? "INFO" : "WARN",
      actorUserId: context.actor.userId, message: "Admin verified saved SMTP connection", meta: result });
    return jsonOk(result, { status: result.verified ? 200 : 503 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonError("Expected an empty JSON object.", 400, "VALIDATION_ERROR");
    return jsonError("Failed to verify SMTP connection.", 503);
  }
}
