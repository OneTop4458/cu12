import { JobType } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { claimNextJob, touchHeartbeat } from "@/server/queue";

const BodySchema = z.object({
  workerId: z.string().min(2).max(120),
  types: z.array(z.nativeEnum(JobType)).default([JobType.SYNC, JobType.AUTOLEARN]),
});

export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  try {
    const body = await parseBody(request, BodySchema);
    const types = body.types ?? [JobType.SYNC, JobType.AUTOLEARN];
    await touchHeartbeat(body.workerId);
    const job = await claimNextJob(body.workerId, types);

    if (!job) {
      return jsonOk({ job: null });
    }

    return jsonOk({
      job: {
        id: job.id,
        type: job.type,
        payload: job.payload,
        attempts: job.attempts,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to claim job", 500);
  }
}
