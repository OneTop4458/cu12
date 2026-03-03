import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const account = await prisma.cu12Account.findUnique({ where: { userId: session.userId } });
  if (!account) {
    return jsonError("CU12 account is not connected", 400);
  }

  const job = await enqueueJob({
    userId: session.userId,
    type: "SYNC",
    payload: { userId: session.userId, reason: "validate_login" },
    idempotencyKey: `sync:${session.userId}:validate-login`,
  });

  const dispatch = await dispatchWorkerRun("sync", session.userId);
  return jsonOk({
    queued: true,
    jobId: job.id,
    accountStatus: account.accountStatus,
    dispatched: dispatch.dispatched,
    dispatchError: dispatch.error,
  });
}
