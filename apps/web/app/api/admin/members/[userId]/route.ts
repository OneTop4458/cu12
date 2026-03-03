import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

interface Params {
  params: Promise<{ userId: string }>;
}

const PatchSchema = z.object({
  role: z.enum(["ADMIN", "USER"]).optional(),
  isTestUser: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  autoLearnEnabled: z.boolean().optional(),
  detectActivitiesEnabled: z.boolean().optional(),
  emailDigestEnabled: z.boolean().optional(),
  accountStatus: z.enum(["CONNECTED", "NEEDS_REAUTH", "ERROR"]).optional(),
  statusReason: z.string().max(500).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;
    const body = await parseBody(request, PatchSchema);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return jsonError("User not found", 404);
    }

    await prisma.$transaction(async (tx) => {
      if (body.role || typeof body.isTestUser === "boolean" || body.name) {
        await tx.user.update({
          where: { id: userId },
          data: {
            role: body.role,
            isTestUser: body.isTestUser,
            name: body.name,
          },
        });
      }

      if (
        typeof body.autoLearnEnabled === "boolean"
        || typeof body.detectActivitiesEnabled === "boolean"
        || typeof body.emailDigestEnabled === "boolean"
        || body.accountStatus
        || Object.prototype.hasOwnProperty.call(body, "statusReason")
      ) {
        await tx.cu12Account.updateMany({
          where: { userId },
          data: {
            autoLearnEnabled: body.autoLearnEnabled,
            detectActivitiesEnabled: body.detectActivitiesEnabled,
            emailDigestEnabled: body.emailDigestEnabled,
            accountStatus: body.accountStatus,
            statusReason: Object.prototype.hasOwnProperty.call(body, "statusReason")
              ? body.statusReason
              : undefined,
          },
        });
      }
    });

    const updated = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isTestUser: true,
        cu12Account: {
          select: {
            cu12Id: true,
            campus: true,
            accountStatus: true,
            statusReason: true,
            autoLearnEnabled: true,
            detectActivitiesEnabled: true,
            emailDigestEnabled: true,
          },
        },
      },
    });

    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "Admin updated member profile",
      meta: body,
    });

    return jsonOk({ updated: true, user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to update member", 500);
  }
}

