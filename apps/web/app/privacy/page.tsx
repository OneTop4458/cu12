import Link from "next/link";
import { PolicyDocumentType } from "@prisma/client";
import { getActiveRequiredPolicies } from "@/server/policy";

export const dynamic = "force-dynamic";

export default async function PrivacyPolicyPage() {
  const policies = await getActiveRequiredPolicies();
  const policy = policies.find((item) => item.type === PolicyDocumentType.PRIVACY_POLICY) ?? null;

  return (
    <main className="dashboard-main page-shell legal-main">
      <section className="card legal-card">
        <header className="legal-header">
          <div>
            <p className="brand-kicker">Legal</p>
            <h1>개인정보처리방침</h1>
            {policy ? (
              <p className="muted">버전 v{policy.version}</p>
            ) : (
              <p className="muted">현재 활성화된 개인정보처리방침이 없습니다.</p>
            )}
          </div>
          <Link href="/login" className="ghost-btn" style={{ alignSelf: "flex-start" }}>
            로그인
          </Link>
        </header>

        {policy ? (
          <pre className="legal-content">{policy.content}</pre>
        ) : (
          <p className="muted">관리자 화면에서 개인정보처리방침을 등록하고 활성화해 주세요.</p>
        )}
      </section>
    </main>
  );
}
