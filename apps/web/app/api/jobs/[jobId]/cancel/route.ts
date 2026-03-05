import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { cancelGitHubRunByWorkerId } from "@/server/github-actions-dispatch";
import { cancelJob, getJobForUser } from "@/server/queue";

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { jobId } = await params;
  const existing = await getJobForUser(jobId, context.effective.userId);
  if (!existing) {
    return jsonError("Job not found", 404);
  }

  try {
    const cancelResult = await cancelJob(jobId);
    const runCancel = cancelResult.updated
      ? await cancelGitHubRunByWorkerId(existing.workerId)
      : {
        state: "NOT_APPLICABLE" as const,
        runId: null,
        errorCode: null,
      };

    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: context.effective.userId,
      message: "Job cancelled",
      meta: {
        jobId,
        status: cancelResult.job.status,
        updated: cancelResult.updated,
        runCancel,
      },
    });

    return jsonOk({
      status: cancelResult.job.status,
      updated: cancelResult.updated,
      runCancel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel job";
    if (message === "Job not found") return jsonError(message, 404);
    return jsonError("Failed to cancel job", 500);
  }
}
