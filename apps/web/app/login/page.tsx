import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteNoticeType } from "@prisma/client";
import { IDLE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, verifyActiveSession } from "@/lib/auth";
import { listSiteNotices } from "@/server/site-notice";
import { LoginForm } from "./login-form";
import { ThemeToggle } from "../../components/theme/theme-toggle";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { reason?: string | string[] };
}) {
  const reasonRaw = searchParams?.reason;
  const reason = Array.isArray(reasonRaw) ? reasonRaw[0] : reasonRaw;
  const timeoutMessage = reason === "session-timeout"
    ? "자동 로그아웃: 30분 이상 활동이 없어 세션이 만료되어 다시 로그인해야 합니다."
    : reason === "session-expired"
      ? "세션이 만료되어 자동으로 로그아웃되었습니다. 다시 로그인해 주세요."
      : null;

  const cookieStore = await cookies();
  const session = await verifyActiveSession(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
    cookieStore.get(IDLE_SESSION_COOKIE_NAME)?.value,
  );
  if (session) {
    redirect("/dashboard");
  }

  const [broadcastNotices, maintenanceNotices] = await Promise.all([
    listSiteNotices(SiteNoticeType.BROADCAST, false),
    listSiteNotices(SiteNoticeType.MAINTENANCE, false),
  ]);

  const activeMaintenanceNotice = maintenanceNotices[0] ?? null;
  const recentBroadcastNotices = broadcastNotices.slice(0, 3);

  return (
    <main className="auth-main">
      <div className="auth-toolbar">
        <ThemeToggle />
      </div>
      <section className="auth-stage">
        <section className="auth-brand">
          <img
            src="/brand/catholic/logo-wordmark.png"
            alt="Catholic University logo"
            className="brand-wordmark"
          />
          <p className="brand-kicker">Catholic University CU12 Automation</p>
          <h1>Catholic University CU12 Automation</h1>
          <p className="muted">
            CU12 로그인 페이지입니다.
          </p>
          <p className="auth-subtitle">
            아이디, 비밀번호를 입력해 로그인하거나 초대 코드 인증을 진행하세요.
          </p>
          <p className="brand-mark">
            Catholic University CU12 Automation
          </p>
        </section>

        <section className="card auth-card brand-login">
          <div className="brand-ribbon" />
          {timeoutMessage ? <p className="session-timeout-banner">{timeoutMessage}</p> : null}
          <p className="brand-kicker">Catholic University CU12 Automation</p>
          <h1>로그인</h1>
          <p className="muted">아이디와 비밀번호를 입력해 로그인하세요.</p>
          {activeMaintenanceNotice ? (
            <section className="top-gap card">
              <p className="error-text">시스템 점검 공지</p>
              <p className="muted">{activeMaintenanceNotice.title}</p>
              <p className="muted">{activeMaintenanceNotice.message}</p>
              <Link className="ghost-btn" href="/maintenance" style={{ alignSelf: "flex-start" }}>
                점검 안내 보기
              </Link>
            </section>
          ) : null}
          {recentBroadcastNotices.length > 0 ? (
            <section className="top-gap card">
              <p className="brand-kicker">공지</p>
              <ul style={{ marginTop: 8, paddingLeft: 16 }}>
                {recentBroadcastNotices.map((notice) => (
                  <li key={notice.id}>
                    <strong>{notice.title}</strong>
                    <p className="muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {notice.message}
                    </p>
                  </li>
                ))}
              </ul>
              <Link className="ghost-btn" href="/notices" style={{ alignSelf: "flex-start", marginTop: 8 }}>
                전체 공지 보기
              </Link>
            </section>
          ) : null}
          <LoginForm />
        </section>
      </section>
    </main>
  );
}
