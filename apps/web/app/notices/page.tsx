import Link from "next/link";
import { SiteNoticeType } from "@prisma/client";
import { listPublicSiteNotices } from "@/server/site-notice";

export default async function NoticesPage() {
  const notices = await listPublicSiteNotices(SiteNoticeType.BROADCAST);

  return (
    <main className="dashboard-main page-shell">
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">CU12 공지</p>
          <h1>전체 공지</h1>
        </div>
        <Link href="/login" className="btn-success" style={{ alignSelf: "flex-start" }}>
          로그인
        </Link>
      </section>

      <section className="card">
        <h2>공지 목록</h2>
        {notices.length === 0 ? (
          <p className="muted">현재 표시할 공지가 없습니다.</p>
        ) : (
          <div className="public-notice-list top-gap">
            {notices.map((notice) => (
              <article key={notice.id} className="public-notice-item">
                <h3 className="public-notice-title">{notice.title}</h3>
                <p className="public-notice-message">{notice.message || "공지 내용이 없습니다."}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
