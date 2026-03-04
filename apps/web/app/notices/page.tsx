import Link from "next/link";
import { SiteNoticeType } from "@prisma/client";
import { listSiteNotices } from "@/server/site-notice";

export const dynamic = "force-dynamic";

function formatRange(startAt: string | null, endAt: string | null) {
  const start = startAt ? new Date(startAt).toLocaleString("ko-KR") : "-";
  const end = endAt ? new Date(endAt).toLocaleString("ko-KR") : "-";
  return `${start} ~ ${end}`;
}

export default async function NoticesPage() {
  const notices = await listSiteNotices(SiteNoticeType.BROADCAST, false);

  return (
    <main className="dashboard-main page-shell">
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">CU12 공지</p>
          <h1>전체 공지</h1>
          <p className="muted">로그인 없이도 전체 공지 목록을 확인할 수 있습니다.</p>
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제목</th>
                  <th>내용</th>
                  <th>우선순위</th>
                  <th>노출 기간</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((notice) => (
                  <tr key={notice.id}>
                    <td>{notice.title}</td>
                    <td>{notice.message}</td>
                    <td>{notice.priority}</td>
                    <td>{formatRange(notice.visibleFrom, notice.visibleTo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
