export default function LoginLoading() {
  return (
    <main className="auth-main">
      <section className="auth-stage">
        <section className="auth-brand">
          <div className="brand-wordmark" style={{ minHeight: 48, opacity: 0.2 }} />
          <p className="brand-kicker">Loading</p>
          <h1>로그인 화면을 준비하고 있습니다.</h1>
          <p className="muted">잠시만 기다려 주세요.</p>
        </section>
        <section className="card auth-card brand-login">
          <p className="brand-kicker">Loading</p>
          <h1>로그인</h1>
          <p className="muted">폼을 불러오는 중입니다.</p>
        </section>
      </section>
    </main>
  );
}
