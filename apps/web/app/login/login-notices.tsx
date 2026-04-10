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
  const recentBroadcastNotices = (await listPublicSiteNotices(SiteNoticeType.BROADCAST, {
    surface: "LOGIN",
  })).slice(0, 3);

  if (recentBroadcastNotices.length === 0) {
    return null;
  }

  return (
    <section className="top-gap card">
      <p className="brand-kicker">{COPY.noticeTitle}</p>
      <p className="muted">{COPY.noticeHint}</p>
      <LoginNoticeAccordion notices={recentBroadcastNotices} />
      <Link className="ghost-btn" href="/notices" style={{ alignSelf: "flex-start", marginTop: 8 }}>
        {COPY.noticesLink}
      </Link>
    </section>
  );
}
