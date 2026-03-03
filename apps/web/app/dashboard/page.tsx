import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  IDLE_SESSION_COOKIE_NAME,
  IMPERSONATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  verifyActiveSession,
  verifyImpersonationToken,
} from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) {
    redirect("/login" as Route);
  }

  if (session.role === "ADMIN") {
    const impersonationToken = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;
    const impersonation = impersonationToken ? await verifyImpersonationToken(impersonationToken) : null;
    if (!impersonation || impersonation.actorUserId !== session.userId) {
      redirect("/admin" as Route);
    }
  }

  return (
    <main className="dashboard-main">
      <DashboardClient
        initialUser={{
          email: session.email,
          role: session.role,
        }}
      />
    </main>
  );
}

