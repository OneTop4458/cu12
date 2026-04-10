import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { listPublicSiteNotices } from "@/server/site-notice";
import { LoginNoticeAccordion } from "./login-notice-accordion";

const COPY = {
  noticeTitle: "공지",
  noticeHint: "목록을 누르면 상세 내용을 펼쳐서 볼 수 있습니다.",
  noticesLink: "전체 공지 보기",
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
    <section className="top-gap card">
      <p className="brand-kicker">{COPY.noticeTitle}</p>
      <p className="muted">{COPY.noticeHint}</p>
      <LoginNoticeAccordion notices={recentLoginNotices} />
      <div className="button-row" style={{ marginTop: 8 }}>
        <Link className="ghost-btn" href="/notices" style={{ alignSelf: "flex-start" }}>
          {COPY.noticesLink}
        </Link>
        {hasMaintenanceNotice ? (
          <Link className="ghost-btn" href="/maintenance" style={{ alignSelf: "flex-start" }}>
            점검 안내 보기
          </Link>
        ) : null}
      </div>
    </section>
  );
}
