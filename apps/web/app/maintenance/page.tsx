import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { listPublicSiteNotices } from "@/server/site-notice";

export default async function MaintenancePage() {
  const notices = await listPublicSiteNotices(SiteNoticeType.MAINTENANCE);

  return (
    <main className="dashboard-main page-shell">
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">CU12 Notice</p>
          <h1>점검 안내</h1>
          <p className="muted">서비스 점검, 기능 제한, 장애 안내를 확인할 수 있습니다.</p>
        </div>
        <Link href="/login" className="btn-success" style={{ alignSelf: "flex-start" }}>
          로그인
        </Link>
      </section>

      <section className="card">
        <h2>점검 및 장애 안내</h2>
        {notices.length === 0 ? (
          <p className="muted">현재 진행 중인 점검 또는 장애 공지가 없습니다.</p>
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
