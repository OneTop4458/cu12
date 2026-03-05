import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getJobForUser } from "@/server/queue";

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { jobId } = await params;
  const job = await getJobForUser(jobId, context.effective.userId);
  if (!job) return jsonError("Job not found", 404);

  return jsonOk({
    id: job.id,
    status: job.status,
    type: job.type,
    attempts: job.attempts,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.lastError,
    result: job.result,
  });
}
