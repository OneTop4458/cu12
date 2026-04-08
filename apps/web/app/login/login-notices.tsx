import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { listPublicSiteNotices } from "@/server/site-notice";

const COPY = {
  serviceNotice: "서비스 공지",
  maintenanceLink: "운영 안내 보기",
  noticeTitle: "공지",
  noticesLink: "전체 공지 보기",
} as const;

export async function LoginNotices() {
  const [broadcastNotices, maintenanceNotices] = await Promise.all([
    listPublicSiteNotices(SiteNoticeType.BROADCAST),
    listPublicSiteNotices(SiteNoticeType.MAINTENANCE),
  ]);

  const activeMaintenanceNotice = maintenanceNotices[0] ?? null;
  const recentBroadcastNotices = broadcastNotices.slice(0, 3);

  if (!activeMaintenanceNotice && recentBroadcastNotices.length === 0) {
    return null;
  }

  return (
    <>
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
    </>
  );
}
