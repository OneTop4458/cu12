import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { invalidateCachedAuthState } from "@/server/auth-state-cache";

interface Params {
  params: Promise<{ userId: string }>;
}

const ApprovalSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  role: z.enum(["ADMIN", "USER"]).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;
    const body = await parseBody(request, ApprovalSchema);
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        withdrawnAt: true,
      },
    });

    if (!target) {
      return jsonError("User not found", 404);
    }
    if (target.withdrawnAt !== null) {
      return jsonError("Target member is already withdrawn.", 409, "MEMBER_WITHDRAWN");
    }
    if (target.id === context.actor.userId && body.action === "REJECT") {
      return jsonError("Cannot reject own account", 400, "SELF_APPROVAL_REJECT_FORBIDDEN");
    }

    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: userId },
      data: body.action === "APPROVE"
        ? {
          approvalStatus: "APPROVED",
          approvalDecidedAt: now,
          approvalDecidedByUserId: context.actor.userId,
          approvalRejectedReason: null,
          isActive: true,
          role: body.role ?? target.role,
        }
        : {
          approvalStatus: "REJECTED",
          approvalDecidedAt: now,
          approvalDecidedByUserId: context.actor.userId,
          approvalRejectedReason: body.reason ?? null,
          isActive: false,
        },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        isTestUser: true,
        approvalStatus: true,
        approvalRequestedAt: true,
        approvalDecidedAt: true,
        approvalDecidedByUserId: true,
        approvalRejectedReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAuditLog({
      category: "ADMIN",
      severity: body.action === "APPROVE" ? "INFO" : "WARN",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: body.action === "APPROVE" ? "Admin approved member" : "Admin rejected member approval",
      meta: {
        action: body.action,
        role: body.action === "APPROVE" ? updated.role : target.role,
        reason: body.action === "REJECT" ? body.reason ?? null : null,
      },
    });

    invalidateCachedAuthState(userId);

    return jsonOk({ updated: true, user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to update member approval", 500);
  }
}
