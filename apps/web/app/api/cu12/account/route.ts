import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import {
  ensureSyncAllowedForUser,
  TEST_USER_SYNC_BLOCKED_ERROR_CODE,
  TEST_USER_SYNC_BLOCKED_MESSAGE,
} from "@/server/queue";
import { getAutomationSettingsAccount, upsertCu12Account } from "@/server/cu12-account";
import { normalizePortalProvider, PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";
import { buildSyncDispatchNotice, queueSyncJobsForUser } from "@/server/sync-job-dispatch";

const PostSchema = z.object({
  provider: z.enum(PORTAL_PROVIDER_VALUES).optional(),
  cu12Id: z.string().min(4).max(80),
  cu12Password: z.string().min(4).max(120),
  campus: z.enum(["SONGSIM", "SONGSIN"]).optional(),
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
    const currentProvider = body.provider ? normalizePortalProvider(body.provider) : undefined;
    const campus = currentProvider === "CYBER_CAMPUS" ? undefined : body.campus;
    if (currentProvider !== "CYBER_CAMPUS" && !campus) {
      return jsonError("CU12 campus is required when connecting CU12 as the current service.", 400, "VALIDATION_ERROR");
    }

    const account = await upsertCu12Account(context.effective.userId, {
      currentProvider,
      cu12Id: body.cu12Id,
      cu12Password: body.cu12Password,
      campus,
    });
    const queued = await queueSyncJobsForUser({
      userId: context.effective.userId,
      campus: account.campus,
      reason: "account-connected",
    });
    const first = queued.results[0] ?? null;

    return jsonOk({
      connected: true,
      provider: account.provider,
      providers: queued.providers,
      results: queued.results,
      queuedJobId: first?.jobId ?? null,
      dispatched: queued.dispatch.dispatched,
      dispatchState: queued.dispatch.state,
      dispatchError: queued.dispatch.error,
      dispatchErrorCode: queued.dispatch.errorCode,
      notice: buildSyncDispatchNotice(queued),
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
