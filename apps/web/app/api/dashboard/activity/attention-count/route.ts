import { PORTAL_PROVIDERS } from "@cu12/core";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getActivityAttentionCount } from "@/server/dashboard";
import { loadOptionalDashboardSegment } from "@/server/dashboard-fallback";

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const providerCounts = await Promise.all(
      PORTAL_PROVIDERS.map((provider) =>
        loadOptionalDashboardSegment(
          "dashboard/activity/attention-count",
          `attention-count-${provider}`,
          () => getActivityAttentionCount(context.effective.userId, provider),
          0,
        )),
    );

    return jsonOk({
      attentionCount: providerCounts.reduce((sum, count) => sum + count, 0),
    }, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[dashboard/activity/attention-count] failed", error);
    return jsonError("Dashboard activity attention count failed.", 503, "DASHBOARD_ACTIVITY_COUNT_FAILED");
  }
}
