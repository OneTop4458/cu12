import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { getNotifications } from "@/server/dashboard";

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const notifications = await getNotifications(session.userId);
  return jsonOk({ notifications });
}
