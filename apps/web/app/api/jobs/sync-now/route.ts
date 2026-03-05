import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { enqueueJob } from "@/server/queue";
import { dispatchManualJob } from "@/server/manual-dispatch-policy";

export async function POST(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const userId = context.effective.userId;
  const { job, deduplicated } = await enqueueJob({
    userId,
    type: "SYNC",
    payload: { userId, reason: "manual_sync" },
    idempotencyKey: `sync:${userId}:manual`,
  });

  const { dispatch } = await dispatchManualJob(userId, "sync", {
    deduplicated,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
  });
  const notice = deduplicated
    ? dispatch.state === "SKIPPED_DUPLICATE"
      ? "동기화 요청이 중복되어 처리되지 않았습니다. 기존 요청 완료 후 반영됩니다."
      : "?대? ?ㅽ뻾 以묒씤 ?숆린???묒뾽???덉뼱 湲곗〈 ?묒뾽 ?곹깭瑜??쒖떆?⑸땲??"
    : dispatch.dispatched
      ? "?숆린???붿껌???묒닔?섏뿀?듬땲??"
      : "?붿껌? ??λ릺?덉?留??뚯빱 利됱떆 ?ㅽ뻾 ?몄텧???ㅽ뙣?덉뒿?덈떎. ?좎떆 ???먮룞 泥섎━?⑸땲??";

  await writeAuditLog({
    category: "JOB",
    severity: "INFO",
    actorUserId: context.actor.userId,
    targetUserId: userId,
    message: "SYNC job requested",
    meta: {
      jobId: job.id,
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
}
