"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type SessionExpiredReason = "session-timeout" | "session-expired";
type Campus = "SONGSIM" | "SONGSIN";
type PolicyType = "PRIVACY_POLICY" | "TERMS_OF_SERVICE";

interface SessionPolicy {
  rememberSession: boolean;
  sessionMaxAgeSeconds: number;
  idleMaxAgeSeconds: number;
}

interface AuthenticatedResponse {
  stage: "AUTHENTICATED";
  user: {
    userId: string;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
  session?: SessionPolicy;
}

interface InviteRequiredResponse {
  stage: "INVITE_REQUIRED";
  challengeToken: string;
}

interface PolicyDocumentResponse {
  type: PolicyType;
  title: string;
  version: number;
  content: string;
}

interface ConsentRequiredResponse {
  stage: "CONSENT_REQUIRED";
  consentToken: string;
  policies: PolicyDocumentResponse[];
  user: {
    userId: string;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
  session?: SessionPolicy;
}

interface ApiErrorResponse {
  error?: string;
  errorCode?: string;
}

type LoginResponse = AuthenticatedResponse | InviteRequiredResponse | ConsentRequiredResponse;

const CAMPUS_OPTIONS: Array<{ value: Campus; label: string }> = [
  { value: "SONGSIM", label: "성심교정" },
  { value: "SONGSIN", label: "성신교정" },
];
const LAST_ACTIVITY_STORAGE_KEY = "cu12:last-activity-at";
const SESSION_EXPIRED_STATE_KEY = "cu12:session-timeout-state";
const LEGACY_IDLE_TIMEOUT_STORAGE_KEY = "cu12:session-idle-timeout-ms";

function applySessionPolicy(policy: SessionPolicy | undefined) {
  if (typeof window === "undefined") return;
  if (!policy) return;
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    window.localStorage.removeItem(SESSION_EXPIRED_STATE_KEY);
    window.localStorage.removeItem(LEGACY_IDLE_TIMEOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function toLoginErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "LOCAL_AUTH_FAILED" || payload.errorCode === "CU12_AUTH_FAILED") {
    return "ID 또는 비밀번호가 일치하지 않습니다.";
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return "계정이 비활성 상태입니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return "요청이 많아 잠시 차단되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  return payload.error ?? "로그인 처리에 실패했습니다.";
}

function toInviteErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "UNAPPROVED_ID") {
    return "승인되지 않은 ID입니다. 운영자에게 계정 생성 권한을 문의해 주세요.";
  }
  if (payload.errorCode === "INVITE_CODE_INVALID") {
    return "초대 코드가 유효하지 않습니다.";
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return "계정이 비활성 상태입니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return "요청이 많아 잠시 차단되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return "인증 상태가 만료되었습니다. 다시 로그인해 주세요.";
  }
  return payload.error ?? "초대 코드 처리에 실패했습니다.";
}

function toConsentErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "POLICY_CONSENT_INCOMPLETE") {
    return "필수 약관 동의가 필요합니다.";
  }
  if (payload.errorCode === "POLICY_VERSION_MISMATCH") {
    return "약관이 갱신되었습니다. 다시 로그인 후 최신 약관에 동의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return "동의 세션이 만료되었습니다. 다시 로그인해 주세요.";
  }
  return payload.error ?? "약관 동의 처리에 실패했습니다.";
}

export function LoginForm({
  sessionExpiredReason: initialSessionExpiredReason,
}: {
  sessionExpiredReason?: SessionExpiredReason;
}) {
  const router = useRouter();
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [rememberSession, setRememberSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredReason] = useState<SessionExpiredReason | null>(() => {
    if (initialSessionExpiredReason) return initialSessionExpiredReason;
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(SESSION_EXPIRED_STATE_KEY);
      return raw === "session-timeout" || raw === "session-expired" ? raw : null;
    } catch {
      return null;
    }
  });

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const [consentPolicies, setConsentPolicies] = useState<PolicyDocumentResponse[]>([]);
  const [policyChecks, setPolicyChecks] = useState<Record<string, boolean>>({});
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const allPoliciesChecked = useMemo(
    () => consentPolicies.length > 0 && consentPolicies.every((policy) => policyChecks[policy.type] === true),
    [consentPolicies, policyChecks],
  );

  const isProcessing = submitting || inviteSubmitting || consentSubmitting;
  const processingMessage = submitting
    ? "로그인 요청 처리 중..."
    : inviteSubmitting
      ? "초대 코드 확인 처리 중..."
      : consentSubmitting
        ? "약관 동의 처리 중..."
        : null;

  function clearConsentState() {
    setShowConsentModal(false);
    setConsentToken(null);
    setConsentPolicies([]);
    setPolicyChecks({});
    setConsentError(null);
  }

  function startConsentFlow(payload: ConsentRequiredResponse) {
    const nextChecks: Record<string, boolean> = {};
    payload.policies.forEach((policy) => {
      nextChecks[policy.type] = false;
    });

    setShowInviteModal(false);
    setChallengeToken(null);
    setInviteCode("");
    setInviteError(null);

    setConsentToken(payload.consentToken);
    setConsentPolicies(payload.policies ?? []);
    setPolicyChecks(nextChecks);
    setConsentError(null);
    setShowConsentModal(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInviteError(null);
    setConsentError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id,
          cu12Password,
          campus,
          rememberSession,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        setError(toLoginErrorMessage(payload));
        return;
      }

      const payload = (await response.json()) as LoginResponse;
      if (payload.stage === "INVITE_REQUIRED") {
        clearConsentState();
        setChallengeToken(payload.challengeToken);
        setInviteCode("");
        setInviteError(null);
        setShowInviteModal(true);
        return;
      }

      if (payload.stage === "CONSENT_REQUIRED") {
        startConsentFlow(payload);
        return;
      }

      applySessionPolicy(payload.session);
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      setInviteError("초대 코드 상태를 확인할 수 없습니다. 로그인 동작을 다시 시작해 주세요.");
      return;
    }

    setInviteSubmitting(true);
    setInviteError(null);
    setConsentError(null);

    try {
      const response = await fetch("/api/auth/login/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          inviteCode: inviteCode.trim(),
          rememberSession,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        const message = toInviteErrorMessage(payload);
        setInviteError(message);
        if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setShowInviteModal(false);
          setChallengeToken(null);
          setError(message);
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse | ConsentRequiredResponse;
      if (payload.stage === "CONSENT_REQUIRED") {
        startConsentFlow(payload);
        return;
      }

      applySessionPolicy(payload.session);
      setShowInviteModal(false);
      setChallengeToken(null);
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setInviteError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function onSubmitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consentToken) {
      setConsentError("동의 세션을 확인할 수 없습니다. 다시 로그인해 주세요.");
      return;
    }
    if (!allPoliciesChecked) {
      setConsentError("모든 필수 약관에 동의해 주세요.");
      return;
    }

    setConsentSubmitting(true);
    setConsentError(null);

    try {
      const acceptedPolicies = consentPolicies.map((policy) => ({
        type: policy.type,
        version: policy.version,
      }));

      const response = await fetch("/api/auth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consentToken,
          acceptedPolicies,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        const message = toConsentErrorMessage(payload);
        setConsentError(message);
        if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          clearConsentState();
          setError(message);
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse;
      applySessionPolicy(payload.session);
      clearConsentState();
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setConsentError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setConsentSubmitting(false);
    }
  }

  return (
    <div className="login-form-shell">
      {sessionExpiredReason ? (
        <div className="session-timeout-banner">
          {sessionExpiredReason === "session-timeout" ? (
            <p>자동 로그아웃: 30분 이상 활동이 없어 세션이 만료되어 다시 로그인해야 합니다.</p>
          ) : (
            <p>세션이 만료되어 자동으로 로그아웃되었습니다. 다시 로그인해 주세요.</p>
          )}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="form-stack">
        <label className="field">
          <span>CU12 ID</span>
          <input
            value={cu12Id}
            onChange={(event) => setCu12Id(event.target.value)}
            autoComplete="username"
            required
            minLength={4}
            placeholder="예: student1234"
          />
        </label>

        <label className="field">
          <span>CU12 비밀번호</span>
          <input
            type="password"
            value={cu12Password}
            onChange={(event) => setCu12Password(event.target.value)}
            autoComplete="current-password"
            required
            minLength={4}
            placeholder="비밀번호를 입력하세요"
          />
        </label>

        <label className="field">
          <span>캠퍼스</span>
          <select value={campus} onChange={(event) => setCampus(event.target.value as Campus)}>
            {CAMPUS_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="check-field">
          <input
            type="checkbox"
            checked={rememberSession}
            onChange={(event) => setRememberSession(event.target.checked)}
          />
          <span>로그인 상태 유지 (30일)</span>
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={submitting} className="btn btn-success">
          {submitting ? <Loader2 className="spin" size={16} /> : null}
          {submitting ? "처리 중..." : "로그인"}
        </button>
      </form>

      {showInviteModal ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            if (!inviteSubmitting) {
              setShowInviteModal(false);
            }
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="초대 코드 입력"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>초대 코드 입력</h2>
            <p className="muted">
              초대 코드를 가지고 계시다면 8자리 이상의 코드를 그대로 입력하고 확인 버튼을 눌러 주세요.
            </p>

            <form onSubmit={onSubmitInvite} className="form-stack">
              <label className="field">
                <span>초대 코드</span>
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  placeholder="예: ABCD-1234"
                />
              </label>

              {inviteError ? <p className="error-text">{inviteError}</p> : null}

              <div className="button-row">
                <button type="submit" disabled={inviteSubmitting} className="btn">
                  {inviteSubmitting ? "처리 중..." : "확인"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowInviteModal(false)}
                  disabled={inviteSubmitting}
                >
                  닫기
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {showConsentModal ? (
        <div className="modal-overlay" role="presentation">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="필수 약관 동의"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>필수 약관 동의</h2>
            <p className="muted">
              마지막 로그인 일시와 IP를 저장하기 위해 필수 약관 동의가 필요합니다.
            </p>

            <form onSubmit={onSubmitConsent} className="form-stack top-gap">
              {consentPolicies.map((policy) => (
                <article key={policy.type} className="card">
                  <div className="button-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{policy.title}</strong>
                    <span className="muted">v{policy.version}</span>
                  </div>
                  <pre
                    style={{
                      marginTop: 8,
                      maxHeight: 180,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: 10,
                      background: "var(--bg-soft)",
                    }}
                  >
                    {policy.content}
                  </pre>
                  <label className="check-field top-gap">
                    <input
                      type="checkbox"
                      checked={policyChecks[policy.type] === true}
                      onChange={(event) =>
                        setPolicyChecks((prev) => ({
                          ...prev,
                          [policy.type]: event.target.checked,
                        }))}
                    />
                    <span>{policy.title}에 동의합니다. (필수)</span>
                  </label>
                </article>
              ))}

              {consentError ? <p className="error-text">{consentError}</p> : null}

              <div className="button-row">
                <button type="submit" className="btn btn-success" disabled={consentSubmitting || !allPoliciesChecked}>
                  {consentSubmitting ? "처리 중..." : "동의하고 로그인"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={clearConsentState}
                  disabled={consentSubmitting}
                >
                  다시 로그인
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isProcessing ? (
        <div className="processing-overlay" role="presentation" aria-live="polite" aria-busy={isProcessing}>
          <section className="modal-card processing-card">
            <h2>처리 중</h2>
            <p className="muted">{processingMessage}</p>
            <div className="loading-bar">
              <span />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
