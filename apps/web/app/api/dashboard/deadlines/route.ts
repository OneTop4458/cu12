import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { getUpcomingDeadlines } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 30);
  const deadlines = await getUpcomingDeadlines(context.effective.userId, limitRaw);
  return jsonOk({ deadlines });
}


