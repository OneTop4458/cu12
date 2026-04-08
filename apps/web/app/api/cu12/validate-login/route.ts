import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import {
  enqueueJob,
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { getCurrentPortalProvider } from "@/server/current-provider";

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);
  const syncGate = await ensureSyncAllowedForUser(session.userId);
  if (!syncGate.allowed) {
    return jsonError(TEST_USER_SYNC_BLOCKED_MESSAGE, 409, TEST_USER_SYNC_BLOCKED_ERROR_CODE);
  }

  const account = await prisma.cu12Account.findUnique({
    where: { userId: session.userId },
    select: {
      id: true,
      accountStatus: true,
    },
  });
  if (!account) {
    return jsonError("CU12 account is not connected", 400);
  }

  const provider = await getCurrentPortalProvider(session.userId);
  const { job } = await enqueueJob({
    userId: session.userId,
    type: "SYNC",
    payload: { userId: session.userId, provider, reason: "validate_login" },
    idempotencyKey: `sync:${session.userId}:${provider}:validate-login`,
  });

  const dispatch = await dispatchWorkerRun("sync", session.userId);
  return jsonOk({
    queued: true,
    provider,
    jobId: job.id,
    accountStatus: account.accountStatus,
    dispatched: dispatch.dispatched,
    dispatchError: dispatch.error,
  });
}
