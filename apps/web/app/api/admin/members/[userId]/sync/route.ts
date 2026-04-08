import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  enqueueJob,
  cancelBlockedSyncJobsForTestUsers,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { dispatchManualJob } from "@/server/manual-dispatch-policy";
import { writeAuditLog } from "@/server/audit-log";

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

    const { job, deduplicated } = await enqueueJob({
      userId: user.id,
      type: "SYNC",
      payload: {
        userId,
        provider: user.cu12Account.provider,
        reason: "admin_sync_request",
      },
      idempotencyKey: `sync:${user.id}:${user.cu12Account.provider}:admin`,
      runAfter,
    });

    const { dispatch } = await dispatchManualJob(user.id, "sync", {
      deduplicated,
      status: job.status,
      createdAt: job.createdAt,
      runAfter: job.runAfter,
      startedAt: job.startedAt,
    });

    const notice = deduplicated
      ? dispatch.state === "SKIPPED_DUPLICATE"
        ? "동기화 작업이 이미 진행 중입니다. 현재 작업 완료 후 다시 요청해 주세요."
        : "동기화 요청이 중복이었지만 오래된 요청은 새로 요청하도록 처리했습니다."
      : dispatch.dispatched
        ? "동기화 실행을 요청했습니다."
        : "동기화 요청은 저장되었지만 실행 트리거 전송이 실패했습니다. 잠시 후 다시 시도해 주세요.";

    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: user.id,
      message: "Admin requested immediate sync",
      meta: {
        jobId: job.id,
        provider: user.cu12Account.provider,
        deduplicated,
        userId,
        cu12Id: user.cu12Account.cu12Id,
        dispatched: dispatch.dispatched,
        dispatchState: dispatch.state,
        dispatchErrorCode: dispatch.errorCode,
      },
    });

    return jsonOk({
      provider: user.cu12Account.provider,
      jobId: job.id,
      status: job.status,
      deduplicated,
      dispatched: dispatch.dispatched,
      dispatchState: dispatch.state,
      dispatchError: dispatch.error ?? null,
      dispatchErrorCode: dispatch.errorCode,
      notice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to request sync", 500);
  }
}
