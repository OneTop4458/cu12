export default function LoginLoading() {
  return (
    <main className="auth-main">
      <header className="auth-public-topbar" aria-label="CU12">
        <span className="auth-public-logo">CU12 AUTO</span>
      </header>
      <section className="auth-stage">
        <section className="auth-brand">
          <div className="auth-brand-copy">
            <p className="brand-kicker">Loading</p>
            <h1>로그인 화면을 준비하고 있습니다.</h1>
            <p>가톨릭대학교 수강 지원 솔루션을 불러오는 중입니다.</p>
          </div>
        </section>
        <section className="card auth-card brand-login">
          <p className="brand-kicker">Loading</p>
          <h1>로그인</h1>
          <p className="muted">계정 확인 영역을 준비하고 있습니다.</p>
        </section>
      </section>
    </main>
  );
}
