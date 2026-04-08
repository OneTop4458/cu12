import { SiteNoticeType } from "@prisma/client";
import Link from "next/link";
import { listPublicSiteNotices } from "@/server/site-notice";

function formatRange(startAt: string | null, endAt: string | null) {
  const start = startAt ? new Date(startAt).toLocaleString("ko-KR") : "-";
  const end = endAt ? new Date(endAt).toLocaleString("ko-KR") : "-";
  return `${start} ~ ${end}`;
}

export default async function MaintenancePage() {
  const notices = await listPublicSiteNotices(SiteNoticeType.MAINTENANCE);

  return (
    <main className="dashboard-main page-shell">
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">CU12 공지</p>
          <h1>시스템 점검 안내</h1>
          <p className="muted">현재 시스템 점검 관련 공지와 일정을 확인할 수 있습니다.</p>
        </div>
        <Link href="/login" className="btn-success" style={{ alignSelf: "flex-start" }}>
          로그인
        </Link>
      </section>

      <section className="card">
        <h2>예정/진행 중 점검</h2>
        {notices.length === 0 ? (
          <p className="muted">현재 예정/진행 중인 시스템 점검 공지가 없습니다.</p>
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
