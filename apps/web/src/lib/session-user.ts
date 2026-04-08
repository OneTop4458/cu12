import { cookies } from "next/headers";
import {
  IDLE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionTokenPayload,
  verifyActiveSession,
} from "./auth";
import { getCachedActiveUser } from "@/server/auth-state-cache";

export async function getServerActiveSession(): Promise<SessionTokenPayload | null> {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return null;

  const user = await getCachedActiveUser(session.userId);
  if (!user) {
    return null;
  }

  return {
    userId: session.userId,
    email: user.email,
    role: user.role,
  };
}
