import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { buildSyncDispatchNotice, queueSyncJobsForUser } from "@/server/sync-job-dispatch";

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
      campus: true,
      accountStatus: true,
    },
  });
  if (!account) {
    return jsonError("CU12 account is not connected", 400);
  }

  const queued = await queueSyncJobsForUser({
    userId: session.userId,
    campus: account.campus,
    reason: "validate-login",
  });
  const first = queued.results[0] ?? null;

  return jsonOk({
    queued: queued.results.length > 0,
    providers: queued.providers,
    results: queued.results,
    provider: first?.provider ?? null,
    jobId: first?.jobId ?? null,
    accountStatus: account.accountStatus,
    dispatched: queued.dispatch.dispatched,
    dispatchState: queued.dispatch.state,
    dispatchError: queued.dispatch.error,
    dispatchErrorCode: queued.dispatch.errorCode,
    notice: buildSyncDispatchNotice(queued),
  });
}
