import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import { enqueueJob } from "@/server/queue";
import { upsertCu12Account } from "@/server/cu12-account";

const PostSchema = z.object({
  cu12Id: z.string().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
});

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const account = await prisma.cu12Account.findUnique({
    where: { userId: session.userId },
    select: {
      cu12Id: true,
      campus: true,
      accountStatus: true,
      statusReason: true,
      autoLearnEnabled: true,
      detectActivitiesEnabled: true,
      emailDigestEnabled: true,
      updatedAt: true,
    },
  });

  return jsonOk({ account });
}

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, PostSchema);
    await upsertCu12Account(session.userId, {
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus: body.campus ?? "SONGSIM",
    });

    const { job } = await enqueueJob({
      userId: session.userId,
      type: "SYNC",
      payload: { userId: session.userId, reason: "account_connected" },
      idempotencyKey: `sync:${session.userId}:account-connected`,
    });

    const dispatch = await dispatchWorkerRun("sync", session.userId);
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