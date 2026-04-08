import { NextRequest, NextResponse } from "next/server";
import { hasValidCsrfOrigin, jsonError, requireUser } from "@/lib/http";
import { clearAuthCookies } from "@/lib/session-cookie";
import { invalidateCachedAuthState } from "@/server/auth-state-cache";

export async function POST(request: NextRequest) {
  if (!hasValidCsrfOrigin(request)) {
    return jsonError("Forbidden", 403, "CSRF_ORIGIN_INVALID");
  }

  const user = await requireUser(request);
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  if (user) {
    invalidateCachedAuthState(user.userId);
  }
  return response;
}

