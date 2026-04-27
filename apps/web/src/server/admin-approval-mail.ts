import { JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun, type WorkerDispatchResult } from "@/server/github-actions-dispatch";
import { writeAuditLogBestEffort } from "@/server/auth-best-effort";

export interface AdminApprovalMailQueueSummary {
  queued: number;
  skipped: number;
  dispatch: WorkerDispatchResult;
}

function buildAdminApprovalRequestIdempotencyKey(adminUserId: string, requestedUserId: string): string {
  return `admin-approval-request:${adminUserId}:${requestedUserId}`;
}

export async function queueAdminApprovalRequestMailJobs(input: {
  requestedUserId: string;
  requestedCu12Id: string;
  requestedAt: Date;
}): Promise<AdminApprovalMailQueueSummary> {
  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      isActive: true,
      withdrawnAt: null,
      approvalStatus: "APPROVED",
    },
    select: {
      id: true,
      email: true,
      mailSubs: {
        where: { enabled: true },
        take: 1,
        select: { email: true },
      },
    },
  });

  let queued = 0;
  let skipped = 0;

  for (const admin of admins) {
    const toEmail = admin.mailSubs[0]?.email?.trim() ?? "";
    if (!toEmail) {
      skipped += 1;
      continue;
    }

    const idempotencyKey = buildAdminApprovalRequestIdempotencyKey(admin.id, input.requestedUserId);
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: admin.id,
        type: JobType.MAIL_DIGEST,
        idempotencyKey,
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.jobQueue.create({
      data: {
        userId: admin.id,
        type: JobType.MAIL_DIGEST,
        payload: {
          userId: admin.id,
          mailKind: "ADMIN_APPROVAL_REQUEST",
          requestedUserId: input.requestedUserId,
          requestedCu12Id: input.requestedCu12Id,
          requestedAt: input.requestedAt.toISOString(),
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey,
        runAfter: new Date(),
      },
    });
    queued += 1;
  }

  if (admins.length === 0 || queued === 0) {
    await writeAuditLogBestEffort({
      category: "MAIL",
      severity: "WARN",
      targetUserId: input.requestedUserId,
      message: "Admin approval request mail skipped",
      meta: {
        requestedCu12Id: input.requestedCu12Id,
        reason: admins.length === 0 ? "NO_ACTIVE_APPROVED_ADMIN" : "NO_ADMIN_MAIL_RECIPIENT",
        adminCount: admins.length,
        skipped,
      },
    });
  }

  const dispatch = queued > 0
    ? await dispatchWorkerRun("digest")
    : {
      state: "SKIPPED_NO_PENDING" as const,
      dispatched: false,
      errorCode: null,
    };

  return { queued, skipped, dispatch };
}
