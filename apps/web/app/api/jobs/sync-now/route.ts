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
    runAfter: job.runAfter,
    startedAt: job.startedAt,
  });
  const notice = deduplicated
    ? dispatch.state === "SKIPPED_DUPLICATE"
      ? "동기화 작업이 이미 진행 중입니다. 현재 작업 완료 후 다시 요청해 주세요."
      : "동기화 요청이 중복이었지만 오래된 작업은 새로 요청하도록 처리했습니다."
    : dispatch.dispatched
      ? "동기화 실행을 요청했습니다."
      : "동기화 요청은 저장되었지만 실행 트리거 전송이 실패했습니다. 잠시 후 다시 시도해 주세요.";

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
