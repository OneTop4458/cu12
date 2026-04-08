import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getCurrentPortalProvider } from "@/server/current-provider";
import { getDashboardSummary } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const provider = await timing.measure("provider-detect", () =>
    getCurrentPortalProvider(context.effective.userId),
  );
  const summary = await timing.measure("summary", () =>
    getDashboardSummary(context.effective.userId, provider),
  );
  return applyServerTimingHeader(jsonOk(summary), timing);
}

