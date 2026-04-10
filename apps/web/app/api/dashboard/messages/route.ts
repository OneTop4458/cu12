import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getMessages } from "@/server/dashboard";
import { loadOptionalDashboardSegment } from "@/server/dashboard-fallback";
import { resolveRequestPortalProvider } from "@/server/request-provider";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const provider = await resolveRequestPortalProvider(request, context.effective.userId);
    const messages = await loadOptionalDashboardSegment(
      "dashboard/messages",
      "messages",
      () => getMessages(context.effective.userId, provider, limit),
      [],
    );
    return jsonOk({
      messages: messages.map((message) => ({
        ...message,
        provider,
      })),
    });
  } catch (error) {
    console.error("[dashboard/messages] failed", error);
    return jsonError("Dashboard messages failed. Please refresh and try again.", 503, "DASHBOARD_MESSAGES_FAILED");
  }
}
