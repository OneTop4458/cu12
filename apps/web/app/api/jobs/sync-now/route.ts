import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const { job, deduplicated } = await enqueueJob({
    userId: session.userId,
    type: "SYNC",
    payload: { userId: session.userId, reason: "manual_sync" },
    idempotencyKey: `sync:${session.userId}:manual`,
  });

  const dispatch = await dispatchWorkerRun("sync", session.userId);
  const notice = deduplicated
    ? "이미 진행 중인 동기화 작업이 있어 기존 작업 상태를 표시합니다."
    : dispatch.dispatched
      ? "동기화 작업이 정상 등록되었습니다."
      : "작업은 큐에 등록되었고 워커 호출은 지연 중입니다. 잠시 후 다시 확인하세요.";

  return jsonOk({
    jobId: job.id,
    status: job.status,
    deduplicated,
    dispatched: dispatch.dispatched,
    dispatchError: dispatch.error,
    notice,
  });
}