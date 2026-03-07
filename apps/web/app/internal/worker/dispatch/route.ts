import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { dispatchWorkerRun, type WorkerDispatchType } from "@/server/github-actions-dispatch";

const BodySchema = z.object({
  trigger: z.enum(["sync", "autolearn"]),
});

export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  try {
    const body = await parseBody(request, BodySchema);
    const trigger = body.trigger as WorkerDispatchType;
    const dispatched = await dispatchWorkerRun(trigger);
    return jsonOk(dispatched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to request worker dispatch", 500);
  }
}
