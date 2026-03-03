import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/login" as Route);
  }

  const session = await verifySessionToken(token);
  if (!session) {
    redirect("/login" as Route);
  }

  if (session.role !== "ADMIN") {
    redirect("/dashboard" as Route);
  }

  return (
    <main className="dashboard-main">
      <AdminClient
        initialUser={{
          email: session.email,
          role: session.role,
        }}
      />
    </main>
  );
}


