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
      startedAt: job.startedAt,
    });
    const notice = deduplicated
      ? dispatch.state === "SKIPPED_DUPLICATE"
        ? "자동수강 요청이 중복되어 처리되지 않았습니다. 기존 요청 완료 후 반영됩니다."
        : "?대? ?ㅽ뻾 以묒씤 ?먮룞?섍컯 ?묒뾽???덉뼱 湲곗〈 ?묒뾽 ?곹깭瑜??쒖떆?⑸땲??"
      : dispatch.dispatched
        ? "?먮룞?섍컯 ?붿껌???묒닔?섏뿀?듬땲?? 吏꾪뻾瑜좎? ?붾㈃?먯꽌 ?ㅼ떆媛꾩쑝濡??뺤씤?????덉뒿?덈떎."
        : "?붿껌? ??λ릺?덉?留??뚯빱 利됱떆 ?ㅽ뻾 ?몄텧???ㅽ뙣?덉뒿?덈떎. ?좎떆 ???먮룞 泥섎━?⑸땲??";

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
