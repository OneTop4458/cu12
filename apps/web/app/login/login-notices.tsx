import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { listPublicSiteNotices } from "@/server/site-notice";
import { LoginNoticeAccordion } from "./login-notice-accordion";

const COPY = {
  noticeTitle: "\uACF5\uC9C0",
  noticesLink: "\uC804\uCCB4 \uACF5\uC9C0",
  maintenanceLink: "\uC810\uAC80 \uC548\uB0B4",
} as const;

export async function LoginNotices() {
  const [maintenanceNotices, recentBroadcastNotices] = await Promise.all([
    listPublicSiteNotices(SiteNoticeType.MAINTENANCE, {
      surface: "LOGIN",
    }),
    listPublicSiteNotices(SiteNoticeType.BROADCAST, {
      surface: "LOGIN",
    }),
  ]);
  const recentLoginNotices = [...maintenanceNotices, ...recentBroadcastNotices].slice(0, 3);
  const hasMaintenanceNotice = maintenanceNotices.length > 0;

  if (recentLoginNotices.length === 0) {
    return null;
  }

  return (
    <section className="login-notice-panel">
      <div className="login-notice-panel-head">
        <p className="brand-kicker">{COPY.noticeTitle}</p>
        <div className="login-notice-links">
          <Link href="/notices">{COPY.noticesLink}</Link>
          {hasMaintenanceNotice ? <Link href="/maintenance">{COPY.maintenanceLink}</Link> : null}
        </div>
      </div>
      <LoginNoticeAccordion notices={recentLoginNotices} />
    </section>
  );
}
