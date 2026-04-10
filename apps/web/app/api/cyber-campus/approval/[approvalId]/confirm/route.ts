import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { confirmCyberCampusApproval } from "@/server/cyber-campus-autolearn";
import { normalizeCyberCampusTransportError } from "@/server/cyber-campus-errors";

const BodySchema = z.object({
  code: z.string().max(20).optional(),
});

interface Params {
  params: Promise<{ approvalId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const { approvalId } = await params;
    const body = await parseBody(request, BodySchema);
    const result = await confirmCyberCampusApproval({
      userId: context.effective.userId,
      approvalId,
      code: body.code ?? null,
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400);
    }

    const normalized = normalizeCyberCampusTransportError(error);
    if (normalized) {
      await writeAuditLog({
        category: "JOB",
        severity: "ERROR",
        actorUserId: context.actor.userId,
        targetUserId: context.effective.userId,
        message: "Cyber Campus approval confirm transport error",
        meta: normalized.details,
      });
      return jsonError(normalized.message, normalized.status, normalized.errorCode);
    }

    const message = error instanceof Error ? error.message : "Failed to confirm Cyber Campus approval";
    if (message.includes("not found") || message.includes("찾을 수 없습니다")) {
      return jsonError(message, 404);
    }
    return jsonError(message, 400);
  }
}
