import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

const BodySchema = z.object({
  mode: z.enum(["SINGLE_NEXT", "SINGLE_ALL", "ALL_COURSES"]).default("ALL_COURSES"),
  lectureSeq: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);

    if (body.mode !== "ALL_COURSES" && !body.lectureSeq) {
      return jsonError("lectureSeq is required for SINGLE modes", 400);
    }

    const lecturePart = body.lectureSeq ? String(body.lectureSeq) : "all";
    const { job, deduplicated } = await enqueueJob({
      userId: session.userId,
      type: "AUTOLEARN",
      payload: {
        userId: session.userId,
        lectureSeq: body.lectureSeq,
        autoLearnMode: body.mode,
        reason: body.reason ?? "manual_request",
      },
      idempotencyKey: `autolearn:${session.userId}:${body.mode}:${lecturePart}`,
    });

    const dispatch = await dispatchWorkerRun("autolearn", session.userId);
    const notice = deduplicated
      ? "이미 실행 중인 자동수강 작업이 있어 기존 작업 상태를 표시합니다."
      : dispatch.dispatched
        ? "자동수강 요청을 접수했습니다. 진행률은 화면에서 실시간으로 확인할 수 있습니다."
        : "요청은 큐에 저장됐지만 워커 즉시 실행 호출이 지연 중입니다. 잠시 후 자동 처리됩니다.";

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
