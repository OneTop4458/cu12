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
    redirect(session.role === "ADMIN" ? "/admin" : "/dashboard");
  }

  return (
    <main className="auth-main">
      <section className="auth-stage">
        <section className="auth-brand">
          <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 [CU12 Automation]</p>
          <h1>가톨릭대학교 공유대학 수강 지원 솔루션</h1>
          <p className="muted">CU12 로그인부터 수강 동기화, 과제/공지 확인, 자동 학습까지를 한 화면에서 처리합니다.</p>
          <p className="auth-subtitle">
            실시간 작업 상태와 알림, 관리자 운영도 지원하는 전용 대시보드로 바로 이동할 수 있습니다.
          </p>
          <p className="brand-mark">📘 수강 지원 대시보드</p>
        </section>

        <section className="card auth-card brand-login">
          <div className="brand-ribbon" />
          <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 [CU12 Automation]</p>
          <h1>로그인</h1>
          <p className="muted">계정 정보를 입력하고 안전하게 접속하세요.</p>
          <LoginForm />
        </section>
      </section>
    </main>
  );
}
