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
      <section className="card auth-card brand-login">
        <div className="brand-ribbon" />
        <p className="brand-kicker">CATHOLIC SHARED UNIVERSITY</p>
        <h1>{"\uAC00\uD1A8\uB9AD \uACF5\uC720\uB300 \uB85C\uADF8\uC778"}</h1>
        <p className="muted">
          {"\uAC00\uD1A8\uB9AD \uACF5\uC720\uB300 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uC138\uC694."}
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
