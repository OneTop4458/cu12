import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { markJobSucceeded } from "@/server/queue";

const BodySchema = z.object({
  jobId: z.string().min(10),
  workerId: z.string().min(2).max(120),
  result: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  try {
    const body = await parseBody(request, BodySchema);
    const job = await markJobSucceeded(body.jobId, body.workerId, body.result);
    return jsonOk({ updated: true, status: job.status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to finish job", 500);
  }
}
