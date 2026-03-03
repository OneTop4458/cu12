import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const job = await enqueueJob({
    userId: session.userId,
    type: "SYNC",
    payload: { userId: session.userId, reason: "manual_sync" },
    idempotencyKey: `sync:${session.userId}:manual`,
  });

  const dispatch = await dispatchWorkerRun("sync", session.userId);
  return jsonOk({
    jobId: job.id,
    status: job.status,
    dispatched: dispatch.dispatched,
    dispatchError: dispatch.error,
  });
}
