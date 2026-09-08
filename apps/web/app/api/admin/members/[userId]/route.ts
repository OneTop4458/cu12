import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/token";
import { writeAuditLog } from "@/server/audit-log";
import { invalidateCachedAuthState } from "@/server/auth-state-cache";

interface Params {
  params: Promise<{ userId: string }>;
}

const PatchSchema = z.object({
  role: z.enum(["ADMIN", "USER"]).optional(),
  isTestUser: z.boolean().optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  localPassword: z.string().trim().max(120).refine((value) => value.length === 0 || value.length >= 8, {
    message: "Local password must contain at least 8 characters",
  }).optional(),
  campus: z.enum(["SONGSIM", "SONGSIN"]).optional(),
  autoLearnEnabled: z.boolean().optional(),
  quizAutoSolveEnabled: z.boolean().optional(),
  detectActivitiesEnabled: z.boolean().optional(),
  emailDigestEnabled: z.boolean().optional(),
  accountStatus: z.enum(["CONNECTED", "NEEDS_REAUTH", "ERROR"]).optional(),
  statusReason: z.string().max(500).nullable().optional(),
  mailPreference: z.object({
    email: z.string().trim().email().max(200),
    enabled: z.boolean(),
    alertOnDeadline: z.boolean(),
    alertOnAutolearn: z.boolean(),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Provide at least one member field" });

class MemberUpdateConflictError extends Error {
  constructor(message: string, readonly errorCode: string) {
    super(message);
  }
}

const DeleteSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

function isPrismaCompatibilityError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError;
}

async function runWithdrawalCleanupStep(
  userId: string,
  step: string,
  work: () => Promise<unknown>,
  failures: string[],
) {
  try {
    await work();
  } catch (error) {
    failures.push(step);
    console.error("[admin] Member withdrawal cleanup step failed.", {
      userId,
      step,
      name: error instanceof Error ? error.name : typeof error,
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

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
        approvalStatus: true,
        cu12Account: { select: { id: true } },
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
    if (userId === context.actor.userId && body.role === "USER") {
      return jsonError("Cannot demote own account", 400);
    }
    if (userId === context.actor.userId && body.isTestUser !== undefined && body.isTestUser !== user.isTestUser) {
      return jsonError("Cannot change own account type.", 400, "OWN_ACCOUNT_TYPE_CHANGE_NOT_ALLOWED");
    }
    if (body.isActive === true && user.approvalStatus !== "APPROVED") {
      return jsonError("Approve the member before activating the account.", 409, "MEMBER_APPROVAL_REQUIRED");
    }
    const nextIsTestUser = body.isTestUser ?? user.isTestUser;
    if (nextIsTestUser && !user.isTestUser && !hasLocalPassword) {
      return jsonError("A local password is required when converting to a test user.", 400, "LOCAL_PASSWORD_REQUIRED");
    }
    if (hasLocalPassword && !nextIsTestUser) {
      return jsonError("Local passwords are only available for test users.", 400, "LOCAL_PASSWORD_NOT_ALLOWED");
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
    if (hasLocalPassword && nextIsTestUser) {
      userData.passwordHash = await hashPassword(localPassword);
    }

    const updateAccount =
      typeof body.campus === "string"
      || typeof body.autoLearnEnabled === "boolean"
      || typeof body.quizAutoSolveEnabled === "boolean"
      || typeof body.detectActivitiesEnabled === "boolean"
      || typeof body.emailDigestEnabled === "boolean"
      || body.accountStatus
      || Object.prototype.hasOwnProperty.call(body, "statusReason");
    if (updateAccount && !user.cu12Account) {
      return jsonError("Link a portal account before editing account settings.", 409, "MEMBER_ACCOUNT_REQUIRED");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const memberUpdate = await tx.user.updateMany({
        where: {
          id: userId,
          withdrawnAt: null,
          approvalStatus: user.approvalStatus,
          isTestUser: user.isTestUser,
        },
        data: { ...userData, updatedAt: new Date() },
      });
      if (memberUpdate.count !== 1) {
        throw new MemberUpdateConflictError("Member state changed. Refresh and try again.", "MEMBER_CHANGED");
      }

      if (updateAccount || body.mailPreference) {
        const accountUpdate = await tx.cu12Account.updateMany({
          where: { userId },
          data: {
            campus: body.campus,
            autoLearnEnabled: body.autoLearnEnabled,
            quizAutoSolveEnabled: body.quizAutoSolveEnabled,
            detectActivitiesEnabled: body.detectActivitiesEnabled,
            emailDigestEnabled: body.mailPreference ? false : body.emailDigestEnabled,
            accountStatus: body.accountStatus,
            statusReason: Object.prototype.hasOwnProperty.call(body, "statusReason")
              ? body.statusReason
              : undefined,
            updatedAt: new Date(),
          },
        });
        if (updateAccount && accountUpdate.count !== 1) {
          throw new MemberUpdateConflictError("Link a portal account before editing account settings.", "MEMBER_ACCOUNT_REQUIRED");
        }
      }

      if (body.mailPreference) {
        const preference = { ...body.mailPreference, alertOnNotice: false, digestEnabled: false };
        await tx.mailSubscription.upsert({
          where: { userId },
          update: preference,
          create: { userId, ...preference },
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
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
          cu12Account: {
            select: {
              cu12Id: true,
              campus: true,
              accountStatus: true,
              statusReason: true,
              autoLearnEnabled: true,
              quizAutoSolveEnabled: true,
              detectActivitiesEnabled: true,
              emailDigestEnabled: true,
            },
          },
          mailSubs: {
            select: {
              email: true,
              enabled: true,
              alertOnNotice: true,
              alertOnDeadline: true,
              alertOnAutolearn: true,
              digestEnabled: true,
              digestHour: true,
              updatedAt: true,
            },
          },
        },
      });
    });

    invalidateCachedAuthState(userId);
    await writeAuditLog({
      category: "ADMIN",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "Admin updated member profile",
      meta: {
        updatedFields: Object.keys(body).filter((field) => field !== "localPassword" || hasLocalPassword),
        localPasswordUpdated: !!userData.passwordHash,
      },
    });

    const { mailSubs, ...updatedUser } = updated;
    return jsonOk({ updated: true, user: { ...updatedUser, mailPreference: mailSubs[0] ?? null } });
  } catch (error) {
    if (error instanceof MemberUpdateConflictError) {
      return jsonError(error.message, 409, error.errorCode);
    }
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
    await prisma.user.update({
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

    const cleanupFailures: string[] = [];
    await runWithdrawalCleanupStep(userId, "delete-cu12-account", () =>
      prisma.cu12Account.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-mail-subscription", () =>
      prisma.mailSubscription.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-task-deadline-alerts", () =>
      prisma.taskDeadlineAlert.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-course-notices", () =>
      prisma.courseNotice.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-course-snapshots", () =>
      prisma.courseSnapshot.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-learning-runs", () =>
      prisma.learningRun.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-learning-tasks", () =>
      prisma.learningTask.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-notification-events", () =>
      prisma.notificationEvent.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-portal-messages", () =>
      prisma.portalMessage.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-portal-approval-sessions", () =>
      prisma.portalApprovalSession.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "delete-portal-sessions", () =>
      prisma.portalSession.deleteMany({ where: { userId } }), cleanupFailures);
    await runWithdrawalCleanupStep(userId, "cancel-jobs", () =>
      prisma.jobQueue.updateMany({
        where: {
          userId,
          status: { in: ["PENDING", "BLOCKED", "RUNNING"] },
        },
        data: {
          status: "CANCELED",
          activeDedupeKey: null,
          finishedAt: withdrawnAt,
          lastError: "Canceled due to member withdrawal",
        },
      }), cleanupFailures);

    try {
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
          cleanupFailures,
        },
      });
    } catch (error) {
      console.warn("[admin] Member withdrawal audit log failed.", {
        userId,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      invalidateCachedAuthState(userId);
    } catch (error) {
      console.warn("[admin] Member withdrawal cache invalidation failed.", {
        userId,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return jsonOk({
      deleted: true,
      deactivated: true,
      userId,
      cleanupFailures,
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
    if (isPrismaCompatibilityError(error)) {
      return jsonError("Failed to withdraw member due to legacy schema mismatch", 409, "MEMBER_DELETE_SCHEMA_MISMATCH");
    }
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to withdraw member", 500);
  }
}
