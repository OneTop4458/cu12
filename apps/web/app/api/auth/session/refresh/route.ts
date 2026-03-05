import { NextRequest } from "next/server";
import {
  IDLE_SESSION_COOKIE_NAME,
  resolveSessionLifetimePolicy,
  signIdleSessionToken,
  verifyIdleSessionToken,
} from "@/lib/auth";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { setIdleSessionCookieWithMaxAge } from "@/lib/session-cookie";

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const currentIdleToken = request.cookies.get(IDLE_SESSION_COOKIE_NAME)?.value;
  if (!currentIdleToken) return jsonError("Unauthorized", 401);

  const idlePayload = await verifyIdleSessionToken(currentIdleToken);
  if (!idlePayload || idlePayload.userId !== user.userId) {
    return jsonError("Unauthorized", 401);
  }

  const sessionPolicy = resolveSessionLifetimePolicy(idlePayload.rememberSession);
  const idleSessionToken = await signIdleSessionToken(user.userId, {
    rememberSession: sessionPolicy.rememberSession,
    maxAgeSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
  });
  const response = jsonOk({
    ok: true,
    expiresInSeconds: sessionPolicy.idleSessionMaxAgeSeconds,
    rememberSession: sessionPolicy.rememberSession,
  });
  setIdleSessionCookieWithMaxAge(response, idleSessionToken, sessionPolicy.idleSessionMaxAgeSeconds);
  return response;
}
