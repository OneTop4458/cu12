import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getCurrentPortalProvider } from "@/server/current-provider";
import { getDashboardSummary } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const provider = await getCurrentPortalProvider(context.effective.userId);
  const summary = await getDashboardSummary(context.effective.userId, provider);
  return jsonOk(summary);
}

