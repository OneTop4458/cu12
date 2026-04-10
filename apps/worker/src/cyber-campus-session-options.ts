import type { PortalSessionCookieState } from "./sync-store";

export interface ReusableCyberCampusSessionState {
  status: "ACTIVE" | "EXPIRED" | "INVALID";
  expiresAt: Date | null;
  cookieState: PortalSessionCookieState[];
}

export interface ReusableCyberCampusSessionOptions {
  cookieState: PortalSessionCookieState[];
}

export function resolveReusableCyberCampusSessionOptions(
  session: ReusableCyberCampusSessionState | null,
  nowMs = Date.now(),
): ReusableCyberCampusSessionOptions | undefined {
  if (!session || session.status !== "ACTIVE" || session.cookieState.length === 0) {
    return undefined;
  }

  if (session.expiresAt && session.expiresAt.getTime() <= nowMs) {
    return undefined;
  }

  return {
    cookieState: session.cookieState,
  };
}
