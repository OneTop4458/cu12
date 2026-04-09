import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun, type WorkerDispatchResult } from "@/server/github-actions-dispatch";
import type { PolicyChangePayload } from "@/server/policy";

export interface PolicyUpdateMailQueueSummary {
  queued: number;
  skipped: number;
  skippedUsers: Array<{
    userId: string;
    reason: string;
  }>;
  dispatch: WorkerDispatchResult;
}

function buildPolicyUpdateIdempotencyKey(userId: string, changes: PolicyChangePayload[]): string {
  const versionKey = changes
    .map((change) => `${change.type}:${change.currentVersion}`)
    .sort()
    .join("|");

  return `policy-update:${userId}:${versionKey}`;
}

export async function queuePolicyUpdateMailJobs(
  changes: PolicyChangePayload[],
): Promise<PolicyUpdateMailQueueSummary> {
  if (changes.length === 0) {
    return {
      queued: 0,
      skipped: 0,
      skippedUsers: [],
      dispatch: {
        state: "SKIPPED_NO_PENDING",
        dispatched: false,
        errorCode: null,
      },
    };
  }

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      withdrawnAt: null,
    },
    select: {
      id: true,
      mailSubs: {
        select: {
          email: true,
        },
        take: 1,
      },
    },
  });

  const skippedUsers: PolicyUpdateMailQueueSummary["skippedUsers"] = [];
  let queued = 0;

  for (const user of users) {
    const email = user.mailSubs[0]?.email?.trim() ?? "";
    if (!email) {
      await prisma.mailDelivery.create({
        data: {
          userId: user.id,
          toEmail: "missing-mail-subscription@example.invalid",
          subject: "[CU12] 약관 업데이트 안내",
          status: "SKIPPED",
          error: "MAIL_SUBSCRIPTION_EMAIL_MISSING",
          sentAt: null,
        },
      });
      skippedUsers.push({
        userId: user.id,
        reason: "MAIL_SUBSCRIPTION_EMAIL_MISSING",
      });
      continue;
    }

    const idempotencyKey = buildPolicyUpdateIdempotencyKey(user.id, changes);
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: user.id,
        type: JobType.MAIL_DIGEST,
        idempotencyKey,
        status: {
          in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.SUCCEEDED],
        },
      },
      select: { id: true },
    });

    if (existing) {
      skippedUsers.push({
        userId: user.id,
        reason: "MAIL_JOB_ALREADY_EXISTS",
      });
      continue;
    }

    await prisma.jobQueue.create({
      data: {
        userId: user.id,
        type: JobType.MAIL_DIGEST,
        status: JobStatus.PENDING,
        payload: {
          userId: user.id,
          mailKind: "POLICY_UPDATE",
          policyChanges: changes,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey,
        runAfter: new Date(),
      },
    });
    queued += 1;
  }

  const dispatch = queued > 0
    ? await dispatchWorkerRun("digest")
    : {
      state: "SKIPPED_NO_PENDING" as const,
      dispatched: false,
      errorCode: null,
    };

  return {
    queued,
    skipped: skippedUsers.length,
    skippedUsers,
    dispatch,
  };
}
