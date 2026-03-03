import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

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

  const dispatch = await dispatchWorkerRun("sync", userId);
  const notice = deduplicated
    ? "이미 실행 중인 동기화 작업이 있어 기존 작업 상태를 표시합니다."
    : dispatch.dispatched
      ? "동기화 요청을 접수했습니다."
      : "요청은 큐에 저장됐지만 워커 즉시 실행 호출이 지연 중입니다. 잠시 후 자동 처리됩니다.";

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
    },
  });

  return jsonOk({
    jobId: job.id,
    status: job.status,
    deduplicated,
    dispatched: dispatch.dispatched,
    dispatchError: dispatch.error,
    notice,
  });
}
