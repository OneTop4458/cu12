import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { getDashboardAccount } from "@/server/cu12-account";
import { PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";
import {
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { buildSyncDispatchNotice, queueSyncJobsForUser } from "@/server/sync-job-dispatch";

const BodySchema = z.object({
  providers: z.array(z.enum(PORTAL_PROVIDER_VALUES)).max(2).optional(),
});

export async function POST(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const userId = context.effective.userId;
  const syncGate = await ensureSyncAllowedForUser(userId);
  if (!syncGate.allowed) {
    await writeAuditLog({
      category: "JOB",
      severity: "WARN",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "SYNC job blocked for test user",
      meta: {
        canceledCount: syncGate.canceledCount,
      },
    });
    return jsonError(TEST_USER_SYNC_BLOCKED_MESSAGE, 409, TEST_USER_SYNC_BLOCKED_ERROR_CODE);
  }

  const body = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
  }

  const account = await getDashboardAccount(userId);
  if (!account) {
    return jsonError("CU12 account is not connected", 400, "ACCOUNT_NOT_CONNECTED");
  }

  const queued = await queueSyncJobsForUser({
    userId,
    campus: account.campus,
    requestedProviders: parsed.data.providers,
    reason: "manual",
  });
  const notice = buildSyncDispatchNotice(queued);
  const first = queued.results[0] ?? null;

  await writeAuditLog({
    category: "JOB",
    severity: "INFO",
    actorUserId: context.actor.userId,
    targetUserId: userId,
    message: "SYNC job requested",
    meta: {
      providers: queued.providers,
      results: queued.results,
      dispatched: queued.dispatch.dispatched,
      dispatchState: queued.dispatch.state,
      dispatchErrorCode: queued.dispatch.errorCode,
    },
  });

  return jsonOk({
    providers: queued.providers,
    results: queued.results,
    jobId: first?.jobId ?? null,
    status: first?.status ?? null,
    deduplicated: first?.deduplicated ?? false,
    dispatched: queued.dispatch.dispatched,
    dispatchState: queued.dispatch.state,
    dispatchError: queued.dispatch.error,
    dispatchErrorCode: queued.dispatch.errorCode,
    notice,
  });
}
