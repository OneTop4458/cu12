import type { Route } from "next";
import { redirect } from "next/navigation";
import { getServerActiveSession } from "@/lib/session-user";
import { AdminSystemClient } from "./system-client";

export default async function AdminSystemPage() {
  const session = await getServerActiveSession();
  if (!session) {
    redirect("/login" as Route);
  }

  if (session.role !== "ADMIN") {
    redirect("/dashboard" as Route);
  }

  return (
    <main className="dashboard-main page-shell">
      <AdminSystemClient initialUser={{ email: session.email, role: session.role }} />
    </main>
  );
}

