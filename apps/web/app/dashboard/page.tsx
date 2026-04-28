import type { Route } from "next";
import { redirect } from "next/navigation";
import { getServerActiveSession } from "@/lib/session-user";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await getServerActiveSession();
  if (!session) {
    redirect("/login" as Route);
  }

  return (
    <main className="dashboard-main page-shell">
      <DashboardClient
        initialUser={{
          email: session.email,
          role: session.role,
        }}
      />
    </main>
  );
}

