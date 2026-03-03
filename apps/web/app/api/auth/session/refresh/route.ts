import { NextRequest } from "next/server";
import { IDLE_SESSION_MAX_AGE_SECONDS, signIdleSessionToken } from "@/lib/auth";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { setIdleSessionCookie } from "@/lib/session-cookie";

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const idleSessionToken = await signIdleSessionToken(user.userId);
  const response = jsonOk({
    ok: true,
    expiresInSeconds: IDLE_SESSION_MAX_AGE_SECONDS,
  });
  setIdleSessionCookie(response, idleSessionToken);
  return response;
}
