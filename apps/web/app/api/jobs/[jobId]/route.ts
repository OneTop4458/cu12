import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { getJobForUser } from "@/server/queue";

interface Params {
  params: { jobId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const job = await getJobForUser(params.jobId, session.userId);
  if (!job) return jsonError("Job not found", 404);

  return jsonOk({
    id: job.id,
    status: job.status,
    type: job.type,
    attempts: job.attempts,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.lastError,
    result: job.result,
  });
}
