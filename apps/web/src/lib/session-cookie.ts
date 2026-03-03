import { NextResponse } from "next/server";
import {
  IDLE_SESSION_COOKIE_NAME,
  IDLE_SESSION_MAX_AGE_SECONDS,
  IMPERSONATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "./auth";

function isSecureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(response: NextResponse, sessionToken: string) {
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function setIdleSessionCookie(response: NextResponse, idleSessionToken: string) {
  response.cookies.set(IDLE_SESSION_COOKIE_NAME, idleSessionToken, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: IDLE_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearAuthCookies(response: NextResponse) {
  const options = {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };

  response.cookies.set(SESSION_COOKIE_NAME, "", options);
  response.cookies.set(IDLE_SESSION_COOKIE_NAME, "", options);
  response.cookies.set(IMPERSONATION_COOKIE_NAME, "", options);
}
