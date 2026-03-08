import { cookies } from "next/headers";
import {
  IDLE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionTokenPayload,
  verifyActiveSession,
} from "./auth";
import { prisma } from "./prisma";
import { withWithdrawnAtFallback } from "./withdrawn-compat";

export async function getServerActiveSession(): Promise<SessionTokenPayload | null> {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) return null;

  const user = await withWithdrawnAtFallback(
    () =>
      prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          email: true,
          role: true,
          isActive: true,
          withdrawnAt: true,
        },
      }),
    () =>
      prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          email: true,
          role: true,
          isActive: true,
        },
      }),
  );
  if (!user || !user.isActive || user.withdrawnAt !== null) {
    return null;
  }

  return {
    userId: session.userId,
    email: user.email,
    role: user.role,
  };
}
