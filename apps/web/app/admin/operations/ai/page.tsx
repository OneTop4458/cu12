import type { Route } from "next";
import { redirect } from "next/navigation";
import { getServerActiveSession } from "@/lib/session-user";
import { AdminQuizAiClient } from "./quiz-ai-client";

export default async function AdminQuizAiPage() {
  const session = await getServerActiveSession();
  if (!session) redirect("/login" as Route);
  if (session.role !== "ADMIN") redirect("/dashboard" as Route);
  return <main className="dashboard-main page-shell"><AdminQuizAiClient initialUser={{ email: session.email, role: session.role }} /></main>;
}
