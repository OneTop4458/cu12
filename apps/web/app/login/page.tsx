import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "../../components/theme/theme-toggle";
import { getServerActiveSession } from "@/lib/session-user";
import { listSiteNotices } from "@/server/site-notice";
import { LoginForm } from "./login-form";

const COPY = {
  appName: "Catholic University Automation",
  title: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uC218\uAC15 \uC9C0\uC6D0 \uC194\uB8E8\uC158",
  subtitle: "Catholic University Automation \uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uC785\uB2C8\uB2E4.",
  portalGuide: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uD3EC\uD138 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD55C \uB4A4 \uC774\uC6A9\uD560 \uC11C\uBE44\uC2A4\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.",
  loginTitle: "\uB85C\uADF8\uC778",
  loginIntro: "\uAC00\uD1A8\uB9AD\uB300\uD559\uAD50 \uD3EC\uD138 \uACC4\uC815\uC73C\uB85C \uB85C\uADF8\uC778\uD558\uC138\uC694.",
  serviceNotice: "\uC11C\uBE44\uC2A4 \uACF5\uC9C0",
  maintenanceLink: "\uC6B4\uC601 \uC548\uB0B4 \uBCF4\uAE30",
  noticeTitle: "\uACF5\uC9C0",
  noticesLink: "\uC804\uCCB4 \uACF5\uC9C0 \uBCF4\uAE30",
} as const;

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
          <p className="brand-kicker">{COPY.appName}</p>
          <h1>{COPY.title}</h1>
          <p className="muted">{COPY.subtitle}</p>
          <p className="muted">{COPY.portalGuide}</p>
          <p className="brand-mark">{COPY.appName}</p>
        </section>

        <section className="card auth-card brand-login">
          <div className="brand-ribbon" />
          <p className="brand-kicker">{COPY.appName}</p>
          <h1>{COPY.loginTitle}</h1>
          <p className="muted">{COPY.loginIntro}</p>
          {activeMaintenanceNotice ? (
            <section className="top-gap card">
              <p className="error-text">{COPY.serviceNotice}</p>
              <p className="muted">{activeMaintenanceNotice.title}</p>
              <p className="muted">{activeMaintenanceNotice.message}</p>
              <Link className="ghost-btn" href="/maintenance" style={{ alignSelf: "flex-start" }}>
                {COPY.maintenanceLink}
              </Link>
            </section>
          ) : null}
          {recentBroadcastNotices.length > 0 ? (
            <section className="top-gap card">
              <p className="brand-kicker">{COPY.noticeTitle}</p>
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
                {COPY.noticesLink}
              </Link>
            </section>
          ) : null}
          <LoginForm sessionExpiredReason={sessionExpiredReason} />
        </section>
      </section>
    </main>
  );
}
