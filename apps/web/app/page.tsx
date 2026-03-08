import type { Route } from "next";
import { redirect } from "next/navigation";
import { getServerActiveSession } from "@/lib/session-user";

export default async function HomePage() {
  const session = await getServerActiveSession();
  if (!session) {
    redirect("/login" as Route);
  }

  redirect("/dashboard" as Route);
}

