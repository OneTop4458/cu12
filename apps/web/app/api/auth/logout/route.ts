import { NextRequest, NextResponse } from "next/server";
import { hasValidCsrfOrigin, jsonError } from "@/lib/http";
import { clearAuthCookies } from "@/lib/session-cookie";

export async function POST(request: NextRequest) {
  if (!hasValidCsrfOrigin(request)) {
    return jsonError("Forbidden", 403, "CSRF_ORIGIN_INVALID");
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}

