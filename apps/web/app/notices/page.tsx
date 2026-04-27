import Link from "next/link";
import { SiteNoticeType } from "@prisma/client";
import { listPublicSiteNotices } from "@/server/site-notice";

export default async function NoticesPage() {
  const notices = await listPublicSiteNotices(SiteNoticeType.BROADCAST);

  return (
    <main className="dashboard-main page-shell">
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">CU12 Notice</p>
          <h1>전체 공지</h1>
          <p className="muted">서비스 운영 안내와 사용자 공지를 확인할 수 있습니다.</p>
        </div>
        <Link href="/login" className="btn-success" style={{ alignSelf: "flex-start" }}>
          로그인
        </Link>
      </section>

      <section className="card">
        <h2>공지 목록</h2>
        {notices.length === 0 ? (
          <p className="muted">현재 게시된 공지가 없습니다.</p>
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
