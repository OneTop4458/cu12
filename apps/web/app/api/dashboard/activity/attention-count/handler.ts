import { PORTAL_PROVIDERS, type PortalProvider } from "@cu12/core";
import { NextRequest } from "next/server";
import {
  jsonError,
  jsonOk,
  requireAuthContext,
  type RequestAuthContext,
} from "@/lib/http";
import { getActivityAttentionCount } from "@/server/dashboard";
import { loadOptionalDashboardSegment } from "@/server/dashboard-fallback";

type AttentionCountHandlerDependencies = {
  authenticate: (request: NextRequest) => Promise<RequestAuthContext | null>;
  countProvider: (userId: string, provider: PortalProvider) => Promise<number>;
};

const defaultDependencies: AttentionCountHandlerDependencies = {
  authenticate: requireAuthContext,
  countProvider: (userId, provider) => loadOptionalDashboardSegment(
    "dashboard/activity/attention-count",
    `attention-count-${provider}`,
    () => getActivityAttentionCount(userId, provider),
    0,
  ),
};

function withNoStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}

export function createAttentionCountHandler(
  dependencies: AttentionCountHandlerDependencies = defaultDependencies,
) {
  return async function handleAttentionCount(request: NextRequest) {
    try {
      const context = await dependencies.authenticate(request);
      if (!context) return withNoStore(jsonError("Unauthorized", 401));

      const providerCounts = await Promise.all(
        PORTAL_PROVIDERS.map((provider) =>
          dependencies.countProvider(context.effective.userId, provider)),
      );

      return withNoStore(jsonOk({
        attentionCount: providerCounts.reduce((sum, count) => sum + count, 0),
      }));
    } catch (error) {
      console.error("[dashboard/activity/attention-count] failed", error);
      return withNoStore(jsonError(
        "Dashboard activity attention count failed.",
        503,
        "DASHBOARD_ACTIVITY_COUNT_FAILED",
      ));
    }
  };
}
