import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import {
  enqueueJob,
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { upsertCu12Account } from "@/server/cu12-account";

const PostSchema = z.object({
  cu12Id: z.string().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
});

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const account = await prisma.cu12Account.findUnique({
    where: { userId: context.effective.userId },
    select: {
      cu12Id: true,
      campus: true,
      accountStatus: true,
      statusReason: true,
      autoLearnEnabled: true,
      quizAutoSolveEnabled: true,
      detectActivitiesEnabled: true,
      emailDigestEnabled: true,
      updatedAt: true,
    },
  });

  return jsonOk({ account });
}

export async function POST(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);
  const syncGate = await ensureSyncAllowedForUser(context.effective.userId);
  if (!syncGate.allowed) {
    return jsonError(TEST_USER_SYNC_BLOCKED_MESSAGE, 409, TEST_USER_SYNC_BLOCKED_ERROR_CODE);
  }

  try {
    const body = await parseBody(request, PostSchema);
    await upsertCu12Account(context.effective.userId, {
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus: body.campus ?? "SONGSIM",
    });

    const { job } = await enqueueJob({
      userId: context.effective.userId,
      type: "SYNC",
      payload: { userId: context.effective.userId, reason: "account_connected" },
      idempotencyKey: `sync:${context.effective.userId}:account-connected`,
    });

    const dispatch = await dispatchWorkerRun("sync", context.effective.userId);
    return jsonOk({ connected: true, queuedJobId: job.id, dispatched: dispatch.dispatched, dispatchError: dispatch.error });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to save CU12 account", 500);
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}

