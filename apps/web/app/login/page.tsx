import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IDLE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, verifyActiveSession } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { ThemeToggle } from "../../components/theme/theme-toggle";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (session) {
    redirect(session.role === "ADMIN" ? "/admin" : "/dashboard");
  }

  return (
    <main className="auth-main">
      <div className="auth-toolbar">
        <ThemeToggle />
      </div>
      <section className="auth-stage">
        <section className="auth-brand">
          <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 [CU12 Automation]</p>
          <h1>가톨릭대학교 공유대학 수강 지원 솔루션</h1>
          <p className="muted">CU12 로그인부터 학습·알림·수강 이력을 한 화면에서 안전하게 관리할 수 있는 통합 솔루션입니다.</p>
          <p className="auth-subtitle">
            업무를 빠르게 시작하고, 안정적인 공유대학 운영을 위한 기본 환경을 제공합니다.
          </p>
          <p className="brand-mark">Catholic University · 가톨릭대학교 공유대학 수강 지원 솔루션 [CU12 Automation]</p>
        </section>

        <section className="card auth-card brand-login">
          <div className="brand-ribbon" />
          <img
            src="/brand/catholic/logo-wordmark.png"
            alt="Catholic University logo"
            className="brand-wordmark"
          />
          <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 [CU12 Automation]</p>
          <h1>로그인</h1>
          <p className="muted">아이디와 비밀번호를 입력해 이용을 시작해 주세요.</p>
          <LoginForm />
        </section>
      </section>
    </main>
  );
}
