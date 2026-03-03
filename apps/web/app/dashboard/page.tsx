import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  IMPERSONATION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  verifyImpersonationToken,
  verifySessionToken,
} from "@/lib/auth";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/login" as Route);
  }

  const session = await verifySessionToken(token);
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

