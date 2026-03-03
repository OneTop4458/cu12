import type { Route } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
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
        <h1>CU12 로그인</h1>
        <p className="muted">
          초대 수락 후 발급된 계정으로 로그인하세요.
        </p>
        <LoginForm />
        <p className="muted">
          초대 토큰이 있으면 <Link href={"/invite/accept" as Route}>초대 수락</Link>
        </p>
      </section>
    </main>
  );
}
