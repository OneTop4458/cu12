import Link from "next/link";
import { PolicyDocumentType } from "@prisma/client";
import { getActiveRequiredPolicies } from "@/server/policy";

export const dynamic = "force-dynamic";

export default async function TermsOfServicePage() {
  const policies = await getActiveRequiredPolicies();
  const policy = policies.find((item) => item.type === PolicyDocumentType.TERMS_OF_SERVICE) ?? null;

  return (
    <main className="dashboard-main page-shell legal-main">
      <section className="card legal-card">
        <header className="legal-header">
          <div>
            <p className="brand-kicker">Legal</p>
            <h1>이용약관</h1>
            {policy ? (
              <p className="muted">버전 v{policy.version}</p>
            ) : (
              <p className="muted">현재 활성화된 이용약관이 없습니다.</p>
            )}
          </div>
          <Link href="/login" className="ghost-btn" style={{ alignSelf: "flex-start" }}>
            로그인
          </Link>
        </header>

        {policy ? (
          <pre className="legal-content">{policy.content}</pre>
        ) : (
          <p className="muted">관리자 화면에서 이용약관을 등록하고 활성화해 주세요.</p>
        )}
      </section>
    </main>
  );
}
