import { JobType } from "@prisma/client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { hasPendingJobs } from "@/server/queue";

const BodySchema = z.object({
  types: z.array(z.nativeEnum(JobType)).min(1),
});

export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  try {
    const body = await parseBody(request, BodySchema);
    const pending = await hasPendingJobs(body.types);
    return jsonOk({ pending });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to query pending jobs", 500);
  }
}
