import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDLE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, verifyActiveSession } from "@/lib/auth";
import { SiteNoticesAdminClient } from "./site-notices-client";

export default async function AdminSiteNoticesPage() {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) {
    redirect("/login" as Route);
  }

  if (session.role !== "ADMIN") {
    redirect("/dashboard" as Route);
  }

  return (
    <main className="dashboard-main page-shell">
      <SiteNoticesAdminClient
        initialUser={{
          email: session.email,
          role: session.role,
        }}
      />
    </main>
  );
}

