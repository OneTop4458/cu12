import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { dispatchWorkerRun } from "@/server/github-actions-dispatch";
import {
  enqueueJob,
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { getAutomationSettingsAccount, upsertCu12Account } from "@/server/cu12-account";
import { normalizePortalProvider, PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";

const PostSchema = z.object({
  provider: z.enum(PORTAL_PROVIDER_VALUES).optional().default("CU12"),
  cu12Id: z.string().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).default("SONGSIM"),
});

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const account = await getAutomationSettingsAccount(context.effective.userId);

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
    const provider = normalizePortalProvider(body.provider);
    const campus = provider === "CU12" ? (body.campus ?? "SONGSIM") : null;

    await upsertCu12Account(context.effective.userId, {
      provider,
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });

    const { job } = await enqueueJob({
      userId: context.effective.userId,
      type: "SYNC",
      payload: {
        userId: context.effective.userId,
        provider,
        reason: "account_connected",
      },
      idempotencyKey: `sync:${context.effective.userId}:${provider}:account-connected`,
    });

    const dispatch = await dispatchWorkerRun("sync", context.effective.userId);
    return jsonOk({
      connected: true,
      queuedJobId: job.id,
      dispatched: dispatch.dispatched,
      dispatchError: dispatch.error,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to save account", 500);
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}
