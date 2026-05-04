import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { NextRequest } from "next/server";
import { writeAuditLog } from "@/server/audit-log";
import { getJobReconcileResult, repairOrphanedRunningJobs } from "@/server/jobs-reconcile";

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  return jsonOk(await getJobReconcileResult());
}

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const result = await repairOrphanedRunningJobs();
  await writeAuditLog({
    category: "JOB",
    severity: result.summary.repairedJobsCount > 0 ? "WARN" : "INFO",
    actorUserId: context.actor.userId,
    message: "Admin repaired orphaned RUNNING jobs",
    meta: {
      repairedJobsCount: result.summary.repairedJobsCount,
      skippedJobsCount: result.summary.skippedJobsCount,
      requeuedJobsCount: result.summary.requeuedJobsCount,
      failedJobsCount: result.summary.failedJobsCount,
      retryQueuedCount: result.summary.retryQueuedCount,
      jobIds: result.repairedJobs.map((job) => job.id),
      skippedJobIds: result.skippedJobs.map((job) => job.id),
      canReconcileWithGitHub: result.canReconcileWithGitHub,
      error: result.error ?? null,
    },
  });

  return jsonOk(result);
}
