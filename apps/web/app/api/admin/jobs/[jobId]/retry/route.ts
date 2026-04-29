import { NextRequest } from "next/server";
import { JobType } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  retryJob,
  cancelBlockedSyncJobsForTestUsers,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { writeAuditLog } from "@/server/audit-log";

interface Params {
  params: Promise<{ jobId: string }>;
}

const RetryRequestSchema = z.object({
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const { jobId } = await params;
  let payload: { force?: boolean };
  try {
    payload = await parseBody(request, RetryRequestSchema);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to retry job", 500);
  }

  const existing = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: {
      type: true,
      userId: true,
      user: {
        select: {
          isTestUser: true,
        },
      },
    },
  });
  if (!existing) {
    return jsonError("Job not found", 404);
  }

  const isSyncJob = existing.type === JobType.SYNC || existing.type === JobType.NOTICE_SCAN;
  if (isSyncJob && existing.user.isTestUser) {
    await cancelBlockedSyncJobsForTestUsers(existing.userId);
    return jsonError(TEST_USER_SYNC_BLOCKED_MESSAGE, 409, TEST_USER_SYNC_BLOCKED_ERROR_CODE);
  }

  try {
    const allowCompleted = payload.force ?? false;
    const job = await retryJob(jobId, { allowCompleted });
    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: job.userId,
      message: "Admin retried job",
      meta: {
        jobId,
        allowCompleted,
        status: job.status,
      },
    });

    return jsonOk({
      updated: true,
      status: job.status,
      jobId,
      userId: job.userId,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Job not found") {
        return jsonError("Job not found", 404);
      }
      if (error.message.includes("Cannot retry running job")) {
        return jsonError("Running job cannot be retried", 409, "JOB_RETRY_FORBIDDEN");
      }
      if (error.message.includes("Completed job requires force retry")) {
        return jsonError("Completed job requires force retry", 409, "JOB_RETRY_FORBIDDEN");
      }
    }
    return jsonError("Failed to retry job", 500);
  }
}
