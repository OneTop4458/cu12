import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  cancelBlockedSyncJobsForTestUsers,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { writeAuditLog } from "@/server/audit-log";
import { buildSyncDispatchNotice, queueSyncJobsForUser } from "@/server/sync-job-dispatch";

interface Params {
  params: Promise<{ userId: string }>;
}

const SyncRequestSchema = z.object({
  runAfter: z.string().datetime().optional(),
});

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { userId } = await params;

    const body = await parseBody(request, SyncRequestSchema);
    const runAfter = body.runAfter ? new Date(body.runAfter) : undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        withdrawnAt: true,
        isTestUser: true,
        cu12Account: {
          select: {
            provider: true,
            cu12Id: true,
            campus: true,
          },
        },
      },
    });

    if (!user) {
      return jsonError("User not found", 404);
    }
    if (user.withdrawnAt !== null) {
      return jsonError("Target user is withdrawn", 409, "MEMBER_WITHDRAWN");
    }
    if (!user.isActive) {
      return jsonError("Target user is inactive", 409, "MEMBER_INACTIVE");
    }
    if (user.isTestUser) {
      await cancelBlockedSyncJobsForTestUsers(user.id);
      return jsonError(TEST_USER_SYNC_BLOCKED_MESSAGE, 409, TEST_USER_SYNC_BLOCKED_ERROR_CODE);
    }
    if (!user.cu12Account) {
      return jsonError("Target user has no CU12 account", 409, "MEMBER_NO_CU12");
    }

    const queued = await queueSyncJobsForUser({
      userId: user.id,
      campus: user.cu12Account.campus,
      reason: "admin",
      runAfter,
    });
    const first = queued.results[0] ?? null;
    const notice = buildSyncDispatchNotice(queued);

    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: user.id,
      message: "Admin requested immediate sync",
      meta: {
        providers: queued.providers,
        results: queued.results,
        userId,
        cu12Id: user.cu12Account.cu12Id,
        dispatched: queued.dispatch.dispatched,
        dispatchState: queued.dispatch.state,
        dispatchErrorCode: queued.dispatch.errorCode,
      },
    });

    return jsonOk({
      provider: first?.provider ?? null,
      providers: queued.providers,
      results: queued.results,
      jobId: first?.jobId ?? null,
      status: first?.status ?? null,
      deduplicated: first?.deduplicated ?? false,
      dispatched: queued.dispatch.dispatched,
      dispatchState: queued.dispatch.state,
      dispatchError: queued.dispatch.error ?? null,
      dispatchErrorCode: queued.dispatch.errorCode,
      notice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to request sync", 500);
  }
}
