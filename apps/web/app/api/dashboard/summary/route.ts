import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardSummary } from "@/server/dashboard";
import { resolveRequestPortalProvider } from "@/server/request-provider";

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const provider = await timing.measure("provider-detect", () =>
      resolveRequestPortalProvider(request, context.effective.userId),
    );
    const summary = await timing.measure("summary", () =>
      getDashboardSummary(context.effective.userId, provider),
    );
    return applyServerTimingHeader(jsonOk(summary), timing);
  } catch (error) {
    console.error("[dashboard/summary] failed", error);
    return jsonError("Dashboard summary failed. Please refresh and try again.", 503, "DASHBOARD_SUMMARY_FAILED");
  }
}

