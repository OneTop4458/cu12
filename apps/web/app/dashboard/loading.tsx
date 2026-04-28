export default function DashboardLoading() {
  return (
    <main className="dashboard-main page-shell">
      <section className="grid-kpi">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="card">
            <p className="brand-kicker">Loading</p>
            <h2>데이터를 준비하고 있습니다.</h2>
            <p className="muted">잠시만 기다려 주세요.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
