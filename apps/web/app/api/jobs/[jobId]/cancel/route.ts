import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
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
    const job = await cancelJob(jobId);
    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: context.effective.userId,
      message: "Job cancelled",
      meta: {
        jobId,
        status: job.status,
      },
    });

    return jsonOk({
      status: job.status,
      updated: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel job";
    if (message === "Job not found") return jsonError(message, 404);
    return jsonError("Failed to cancel job", 500);
  }
}
