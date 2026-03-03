export default function HomePage() {
  return (
    <main>
      <h1>CU12 Automation</h1>
      <p>문서 우선 개발 규칙에 따라 API와 워커를 단계적으로 구현한 상태입니다.</p>
      <div className="card">
        <h2>핵심 엔드포인트</h2>
        <ul>
          <li><code>/api/dashboard/summary</code></li>
          <li><code>/api/jobs/sync-now</code></li>
          <li><code>/api/jobs/autolearn-request</code></li>
          <li><code>/api/cu12/account</code></li>
        </ul>
      </div>
      <div className="card">
        <h2>운영 모델</h2>
        <p>기본 동기화는 GitHub Actions 스케줄, 자동 수강은 온디맨드 워커에서 실행됩니다.</p>
      </div>
    </main>
  );
}
