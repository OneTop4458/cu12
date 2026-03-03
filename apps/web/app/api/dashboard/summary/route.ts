import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getDashboardSummary } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const summary = await getDashboardSummary(context.effective.userId);
  return jsonOk(summary);
}

