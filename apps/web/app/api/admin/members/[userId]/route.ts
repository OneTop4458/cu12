import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/token";
import { writeAuditLog } from "@/server/audit-log";

interface Params {
  params: Promise<{ userId: string }>;
}

const PatchSchema = z.object({
  role: z.enum(["ADMIN", "USER"]).optional(),
  isTestUser: z.boolean().optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  localPassword: z.string().min(8).max(120).optional(),
  autoLearnEnabled: z.boolean().optional(),
  detectActivitiesEnabled: z.boolean().optional(),
  emailDigestEnabled: z.boolean().optional(),
  accountStatus: z.enum(["CONNECTED", "NEEDS_REAUTH", "ERROR"]).optional(),
  statusReason: z.string().max(500).nullable().optional(),
});

const DeleteSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;
    const body = await parseBody(request, PatchSchema);
    const localPassword = (body.localPassword ?? "").trim();
    const hasLocalPassword = localPassword.length > 0;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isTestUser: true,
        withdrawnAt: true,
      },
    });
    if (!user) {
      return jsonError("User not found", 404);
    }
    if (user.withdrawnAt !== null) {
      return jsonError("Target member is already withdrawn.", 409, "MEMBER_WITHDRAWN");
    }

    if (userId === context.actor.userId && body.isActive === false) {
      return jsonError("Cannot deactivate own account", 400);
    }

    const userData: {
      role?: "ADMIN" | "USER";
      isTestUser?: boolean;
      isActive?: boolean;
      name?: string;
      passwordHash?: string;
    } = {};

    if (typeof body.role === "string") {
      userData.role = body.role;
    }
    if (typeof body.isTestUser === "boolean") {
      userData.isTestUser = body.isTestUser;
    }
    if (typeof body.isActive === "boolean") {
      userData.isActive = body.isActive;
    }
    if (typeof body.name === "string") {
      userData.name = body.name;
    }
    if (hasLocalPassword && (body.isTestUser ?? user.isTestUser)) {
      userData.passwordHash = await hashPassword(localPassword);
    }

    const updateUser = Object.keys(userData).length > 0;
    const updateAccount =
      typeof body.autoLearnEnabled === "boolean"
      || typeof body.detectActivitiesEnabled === "boolean"
      || typeof body.emailDigestEnabled === "boolean"
      || body.accountStatus
      || Object.prototype.hasOwnProperty.call(body, "statusReason")
      || typeof body.isTestUser === "boolean" && !body.isTestUser;

    await prisma.$transaction(async (tx) => {
      if (updateUser) {
        await tx.user.update({
          where: { id: userId },
          data: userData,
        });
      }

      if (updateAccount) {
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
            updatedAt: new Date(),
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
        isActive: true,
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

    const auditSafeBody = { ...body };
    delete (auditSafeBody as { localPassword?: string }).localPassword;
    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "Admin updated member profile",
      meta: {
        ...auditSafeBody,
        localPasswordUpdated: hasLocalPassword,
      },
    });

    return jsonOk({ updated: true, user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to update member", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;
    const bodyText = await request.text();
    let body: z.infer<typeof DeleteSchema> = {};
    if (bodyText) {
      body = DeleteSchema.parse(JSON.parse(bodyText));
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        withdrawnAt: true,
      },
    });
    if (!user) {
      return jsonError("User not found", 404);
    }
    if (userId === context.actor.userId) {
      return jsonError("Cannot delete own account", 400);
    }
    if (user.withdrawnAt !== null) {
      return jsonError("Member already withdrawn", 404, "MEMBER_NOT_FOUND");
    }

    const withdrawnAt = new Date();
    const anonymizedEmail = `withdrawn-${userId}@withdrawn.local`;
    const anonymizedName = `Withdrawn Account ${userId.slice(0, 8)}`;
    const anonymizedPasswordHash = await hashPassword(generateToken(48));

    await prisma.$transaction(async (tx) => {
      await tx.cu12Account.deleteMany({ where: { userId } });
      await tx.mailSubscription.deleteMany({ where: { userId } });
      await tx.taskDeadlineAlert.deleteMany({ where: { userId } });
      await tx.courseNotice.deleteMany({ where: { userId } });
      await tx.courseSnapshot.deleteMany({ where: { userId } });
      await tx.learningRun.deleteMany({ where: { userId } });
      await tx.learningTask.deleteMany({ where: { userId } });
      await tx.notificationEvent.deleteMany({ where: { userId } });
      await tx.jobQueue.updateMany({
        where: {
          userId,
          status: { in: ["PENDING", "RUNNING"] },
        },
        data: {
          status: "CANCELED",
          finishedAt: withdrawnAt,
          lastError: "Canceled due to member withdrawal",
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          name: anonymizedName,
          passwordHash: anonymizedPasswordHash,
          isActive: false,
          isTestUser: false,
          lastLoginAt: null,
          lastLoginIp: null,
          withdrawnAt,
        },
      });
    });

    await writeAuditLog({
      category: "ADMIN",
      severity: "WARN",
      actorUserId: context.actor.userId,
      message: "Admin withdrew member",
      meta: {
        withdrawnUserId: userId,
        withdrawnUserEmail: user.email,
        withdrawnAt: withdrawnAt.toISOString(),
        reason: body.reason ?? null,
      },
    });

    return jsonOk({
      deleted: true,
      deactivated: true,
      userId,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON payload", 400, "VALIDATION_ERROR");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return jsonError("Member already withdrawn", 404, "MEMBER_NOT_FOUND");
      }
      if (error.code === "P2003") {
        return jsonError("Failed to cleanup related member records", 409, "MEMBER_DELETE_CONSTRAINT");
      }
    }
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to withdraw member", 500);
  }
}
