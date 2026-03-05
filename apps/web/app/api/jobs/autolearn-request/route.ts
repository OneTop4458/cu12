import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

const BodySchema = z.object({
  mode: z.enum(["SINGLE_NEXT", "SINGLE_ALL", "ALL_COURSES"]).default("ALL_COURSES"),
  lectureSeq: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);

    if (body.mode !== "ALL_COURSES" && !body.lectureSeq) {
      return jsonError("lectureSeq is required for SINGLE modes", 400);
    }

    const userId = context.effective.userId;
    const lecturePart = body.lectureSeq ? String(body.lectureSeq) : "all";
    const { job, deduplicated } = await enqueueJob({
      userId,
      type: "AUTOLEARN",
      payload: {
        userId,
        lectureSeq: body.lectureSeq,
        autoLearnMode: body.mode,
        reason: body.reason ?? "manual_request",
      },
      idempotencyKey: `autolearn:${userId}:${body.mode}:${lecturePart}`,
    });

    const dispatch = await dispatchWorkerRun("autolearn", userId);
    const notice = deduplicated
      ? "이미 실행 중인 자동수강 작업이 있어 기존 작업 상태를 표시합니다."
      : dispatch.dispatched
        ? "자동수강 요청을 접수했습니다. 진행률은 화면에서 실시간으로 확인할 수 있습니다."
        : "요청은 큐에 저장됐지만 워커 즉시 실행 호출이 지연 중입니다. 잠시 후 자동 처리됩니다.";

    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "AUTOLEARN job requested",
      meta: {
        jobId: job.id,
        mode: body.mode,
        lectureSeq: body.lectureSeq ?? null,
        deduplicated,
        dispatched: dispatch.dispatched,
        dispatchState: dispatch.state,
        dispatchErrorCode: dispatch.errorCode,
      },
    });

    return jsonOk({
      jobId: job.id,
      status: job.status,
      deduplicated,
      dispatched: dispatch.dispatched,
      dispatchState: dispatch.state,
      dispatchError: dispatch.error,
      dispatchErrorCode: dispatch.errorCode,
      notice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to request auto-learning", 500);
  }
}
