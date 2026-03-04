import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { retryJob } from "@/server/queue";
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
  const payload = await parseBody(request, RetryRequestSchema);

  try {
    const job = await retryJob(jobId, { allowCompleted: payload.force });
    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: job.userId,
      message: "Admin retried job",
      meta: {
        jobId,
        allowCompleted: payload.force,
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
