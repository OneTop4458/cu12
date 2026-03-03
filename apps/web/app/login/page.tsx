import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDLE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, verifyActiveSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (session) {
    redirect((session.role === "ADMIN" ? "/admin" : "/dashboard") as Route);
  }

  return (
    <main className="auth-main">
      <section className="card auth-card brand-login">
        <div className="brand-ribbon" />
        <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 CU12 Learning Support</p>
        <h1>가톨릭 공유대 로그인</h1>
        <p className="muted">가톨릭 공유대 계정으로 로그인하세요.</p>
        <LoginForm />
      </section>
    </main>
  );
}

