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

    const { job, deduplicated } = await enqueueJob({
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
    const notice = deduplicated
      ? "이미 진행 중인 자동 수강 작업이 있어 기존 작업 상태를 표시합니다."
      : dispatch.dispatched
        ? "자동 수강 작업이 정상 등록되었습니다."
        : "작업은 큐에 등록되었고 워커 호출은 지연 중입니다. 잠시 후 다시 확인하세요.";

    return jsonOk({
      jobId: job.id,
      status: job.status,
      deduplicated,
      dispatched: dispatch.dispatched,
      dispatchError: dispatch.error,
      notice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to request auto-learning", 500);
  }
}