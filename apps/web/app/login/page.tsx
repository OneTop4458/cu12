import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteNoticeType } from "@prisma/client";
import { getServerActiveSession } from "@/lib/session-user";
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
  const sessionExpiredReason =
    reason === "session-timeout" || reason === "session-expired" ? reason : undefined;

  const session = await getServerActiveSession();
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
          <p className="brand-kicker">CUK Auto</p>
          <h1>Multi-Portal Learning Automation</h1>
          <p className="muted">
            CU12와 가톨릭대 사이버캠퍼스를 하나의 워크플로우로 연결합니다.
          </p>
          <p className="brand-mark">
            CUK Auto
          </p>
        </section>

        <section className="card auth-card brand-login">
          <div className="brand-ribbon" />
          <p className="brand-kicker">CUK Auto</p>
          <h1>Sign In</h1>
          <p className="muted">포털을 선택하고 계정 정보를 입력해 로그인하세요.</p>
          {activeMaintenanceNotice ? (
            <section className="top-gap card">
              <p className="error-text">서비스 공지</p>
              <p className="muted">{activeMaintenanceNotice.title}</p>
              <p className="muted">{activeMaintenanceNotice.message}</p>
              <Link className="ghost-btn" href="/maintenance" style={{ alignSelf: "flex-start" }}>
                운영 안내 보기
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
          <LoginForm sessionExpiredReason={sessionExpiredReason} />
        </section>
      </section>
    </main>
  );
}
