import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDLE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, verifyActiveSession } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (!session) {
    redirect("/login" as Route);
  }

  redirect("/dashboard" as Route);
}

