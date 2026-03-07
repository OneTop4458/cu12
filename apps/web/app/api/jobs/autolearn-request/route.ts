import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { enqueueJob } from "@/server/queue";
import { dispatchManualJob } from "@/server/manual-dispatch-policy";

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

    const { dispatch } = await dispatchManualJob(userId, "autolearn", {
      deduplicated,
      status: job.status,
      createdAt: job.createdAt,
      runAfter: job.runAfter,
      startedAt: job.startedAt,
    });
    const notice = deduplicated
      ? dispatch.state === "SKIPPED_DUPLICATE"
        ? "같은 조건의 요청이 이미 있어 현재 작업이 끝난 뒤 이어서 진행됩니다."
        : "이전 요청이 오래되어 자동 수강을 다시 시작하도록 준비했습니다."
      : dispatch.dispatched
        ? "자동 수강 요청이 접수되었습니다. 순서대로 곧 시작됩니다."
        : "자동 수강 요청은 접수되었습니다. 실행 준비가 지연되어 시작까지 조금 더 걸릴 수 있습니다.";

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
