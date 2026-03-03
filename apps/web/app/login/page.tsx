import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      redirect("/dashboard" as Route);
    }
  }

  return (
    <main className="auth-main">
      <section className="card auth-card">
        <h1>가톨릭 공유대 로그인</h1>
        <p className="muted">가톨릭 공유대 계정으로 로그인하세요.</p>
        <LoginForm />
      </section>
    </main>
  );
}
