import Link from "next/link";
import { buildPolicyDiffLines } from "@/server/policy-diff";
import {
  buildPolicyDiffPath,
  buildPolicyVersionPath,
  type PolicyDocumentPayload,
} from "@/server/policy";

interface LegalDocumentPageProps {
  title: string;
  emptyMessage: string;
  policy: PolicyDocumentPayload | null;
  comparePolicy: PolicyDocumentPayload | null;
  history: PolicyDocumentPayload[];
}

export function LegalDocumentPage({
  title,
  emptyMessage,
  policy,
  comparePolicy,
  history,
}: LegalDocumentPageProps) {
  const diffLines = policy && comparePolicy
    ? buildPolicyDiffLines(comparePolicy.content, policy.content)
    : [];
  const missingHistoricalVersions = policy ? policy.version > history.length : false;

  return (
    <main className="dashboard-main page-shell legal-main">
      <section className="card legal-card">
        <header className="legal-header">
          <div>
            <p className="brand-kicker">Legal</p>
            <h1>{title}</h1>
            {policy ? (
              <p className="muted">
                현재 버전 v{policy.version}
                {comparePolicy ? ` / 비교 기준 v${comparePolicy.version}` : ""}
              </p>
            ) : (
              <p className="muted">{emptyMessage}</p>
            )}
          </div>
          <Link href="/login" className="ghost-btn" style={{ alignSelf: "flex-start" }}>
            로그인
          </Link>
        </header>

        {policy ? (
          <>
            <div className="button-row top-gap" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
              <a className="ghost-btn" href={buildPolicyVersionPath(policy.type)}>
                최신 문서
              </a>
              {comparePolicy ? (
                <a className="ghost-btn" href={buildPolicyVersionPath(comparePolicy.type, comparePolicy.version)}>
                  비교 기준 문서
                </a>
              ) : null}
              {!comparePolicy && history.length > 1 ? (
                <a
                  className="ghost-btn"
                  href={buildPolicyDiffPath(policy.type, policy.version, history[1]!.version)}
                >
                  이전 버전 비교
                </a>
              ) : null}
              {comparePolicy ? (
                <a
                  className="ghost-btn"
                  href={buildPolicyDiffPath(policy.type, policy.version, comparePolicy.version)}
                >
                  비교 버전 변경
                </a>
              ) : null}
            </div>

            <section className="card top-gap">
              <h2>문서 이력</h2>
              {missingHistoricalVersions ? (
                <p className="error-text top-gap">
                  현재 문서 버전 번호와 게시된 이력 개수가 맞지 않습니다. 누락된 기록이 있을 수 있어 비교 링크가 일부 표시되지 않을 수 있습니다.
                </p>
              ) : null}
              <div className="button-row top-gap" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                {history.map((item, index) => {
                  const previous = history[index + 1] ?? null;
                  return (
                    <div key={item.id} className="button-row" style={{ justifyContent: "flex-start" }}>
                      <a className="ghost-btn" href={buildPolicyVersionPath(item.type, item.version)}>
                        v{item.version}
                      </a>
                      {previous ? (
                        <a
                          className="ghost-btn"
                          href={buildPolicyDiffPath(item.type, item.version, previous.version)}
                        >
                          v{item.version} vs v{previous.version}
                        </a>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            {comparePolicy ? (
              <section className="card top-gap">
                <h2>이전 버전 비교</h2>
                <div
                  style={{
                    display: "grid",
                    gap: 4,
                    marginTop: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                  }}
                >
                  {diffLines.map((line, index) => {
                    const background =
                      line.kind === "added"
                        ? "rgba(34, 197, 94, 0.14)"
                        : line.kind === "removed"
                          ? "rgba(239, 68, 68, 0.14)"
                          : "transparent";
                    const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";

                    return (
                      <pre
                        key={`${line.kind}:${index}`}
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          padding: "6px 8px",
                          borderRadius: 8,
                          background,
                        }}
                      >
                        {`${prefix} ${line.text}`}
                      </pre>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="card top-gap">
              <h2>{comparePolicy ? `v${policy.version} 문서` : "문서 내용"}</h2>
              <pre className="legal-content">{policy.content}</pre>
            </section>
          </>
        ) : (
          <p className="muted top-gap">{emptyMessage}</p>
        )}
      </section>
    </main>
  );
}
