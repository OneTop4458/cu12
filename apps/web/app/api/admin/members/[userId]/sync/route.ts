import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";
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
        isTestUser: true,
        cu12Account: {
          select: {
            cu12Id: true,
          },
        },
      },
    });

    if (!user) {
      return jsonError("User not found", 404);
    }
    if (!user.isActive) {
      return jsonError("Target user is inactive", 409, "MEMBER_INACTIVE");
    }
    if (user.isTestUser || !user.cu12Account) {
      return jsonError("Target user has no CU12 account", 409, "MEMBER_NO_CU12");
    }

    const { job, deduplicated } = await enqueueJob({
      userId: user.id,
      type: "SYNC",
      payload: {
        userId,
        reason: "admin_sync_request",
      },
      idempotencyKey: `sync:${user.id}:admin`,
      runAfter,
    });

    const dispatch = await dispatchWorkerRun("sync", user.id);
    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: user.id,
      message: "Admin requested immediate sync",
      meta: {
        jobId: job.id,
        deduplicated,
        userId,
        cu12Id: user.cu12Account.cu12Id,
        dispatched: dispatch.dispatched,
      },
    });

    const notice = deduplicated
      ? "동일한 동기화 요청이 이미 대기 처리 중입니다."
      : dispatch.dispatched
        ? "동기화가 요청되고 워커 실행이 트리거되었습니다."
        : `동기화가 요청되었으나 워커 트리거에 실패했습니다: ${dispatch.error ?? "unknown"}`;

    return jsonOk({
      jobId: job.id,
      status: job.status,
      deduplicated,
      dispatched: dispatch.dispatched,
      dispatchError: dispatch.error ?? null,
      notice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to request sync", 500);
  }
}
