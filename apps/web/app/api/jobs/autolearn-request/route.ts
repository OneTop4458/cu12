import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

const BodySchema = z.object({
  lectureSeq: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);
    const lecturePart = body.lectureSeq ? String(body.lectureSeq) : "all";

    const job = await enqueueJob({
      userId: session.userId,
      type: "AUTOLEARN",
      payload: {
        userId: session.userId,
        lectureSeq: body.lectureSeq,
        reason: body.reason ?? "manual_request",
      },
      idempotencyKey: `autolearn:${session.userId}:${lecturePart}`,
    });

    const dispatch = await dispatchWorkerRun("autolearn", session.userId);
    return jsonOk({
      jobId: job.id,
      status: job.status,
      dispatched: dispatch.dispatched,
      dispatchError: dispatch.error,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to request auto-learning", 500);
  }
}
