"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { readJsonBody, resolveClientResponseError } from "../../src/lib/client-response";

type SessionExpiredReason = "session-timeout" | "session-expired";
type Campus = "SONGSIM" | "SONGSIN";
type PortalProvider = "CU12" | "CYBER_CAMPUS";
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
    provider?: PortalProvider;
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
    provider?: PortalProvider;
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

const PROVIDER_OPTIONS: Array<{ value: PortalProvider; label: string }> = [
  { value: "CU12", label: "CU12" },
  { value: "CYBER_CAMPUS", label: "사이버캠퍼스" },
];

const LAST_ACTIVITY_STORAGE_KEY = "cu12:last-activity-at";
const SESSION_EXPIRED_STATE_KEY = "cu12:session-timeout-state";
const LEGACY_IDLE_TIMEOUT_STORAGE_KEY = "cu12:session-idle-timeout-ms";
const SAVED_CU12_ID_STORAGE_KEY = "cu12:saved-cu12-id";

function applySessionPolicy(policy: SessionPolicy | undefined) {
  if (typeof window === "undefined" || !policy) return;
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
    window.localStorage.removeItem(SESSION_EXPIRED_STATE_KEY);
    window.localStorage.removeItem(LEGACY_IDLE_TIMEOUT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function syncSavedCu12Id(shouldSave: boolean, cu12Id: string) {
  if (typeof window === "undefined") return;
  try {
    if (!shouldSave) {
      window.localStorage.removeItem(SAVED_CU12_ID_STORAGE_KEY);
      return;
    }

    const trimmed = cu12Id.trim();
    if (!trimmed) {
      window.localStorage.removeItem(SAVED_CU12_ID_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SAVED_CU12_ID_STORAGE_KEY, trimmed);
  } catch {
    // Ignore storage errors.
  }
}

export function toLoginErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "AUTH_FAILED" || payload.errorCode === "CU12_AUTH_FAILED") {
    return "ID 또는 비밀번호가 일치하지 않습니다.";
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return "계정이 비활성화되었습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return "요청이 많아 잠시 차단되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (payload.errorCode === "CU12_UNAVAILABLE" || payload.errorCode === "PORTAL_UNAVAILABLE") {
    return payload.error ?? "Authentication service unavailable.";
  }
  if (payload.errorCode?.startsWith("INTERNAL_DB_") || payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? "Authentication failed.";
  }
  return payload.error ?? "로그인 처리 중 오류가 발생했습니다.";
}

export function toInviteErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "INVITE_VERIFICATION_FAILED") {
    return payload.error ?? "Invite verification failed.";
  }
  if (payload.errorCode === "ACCOUNT_DISABLED") {
    return "계정이 비활성화되었습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "RATE_LIMITED") {
    return "요청이 많아 잠시 차단되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? "Invite verification failed.";
  }
  return payload.error ?? "초대 코드 확인 중 오류가 발생했습니다.";
}

export function toConsentErrorMessage(payload: ApiErrorResponse): string {
  if (payload.errorCode === "POLICY_CONSENT_INCOMPLETE") {
    return "필수 약관에 모두 동의해 주세요.";
  }
  if (payload.errorCode === "POLICY_VERSION_MISMATCH") {
    return "약관 버전이 변경되었습니다. 최신 약관에 다시 동의해 주세요.";
  }
  if (payload.errorCode === "POLICY_NOT_CONFIGURED") {
    return "필수 약관이 아직 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
    return "동의 세션이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (payload.errorCode === "INTERNAL_ERROR") {
    return payload.error ?? "Policy consent failed.";
  }
  return payload.error ?? "약관 동의 처리 중 오류가 발생했습니다.";
}

export function LoginForm({
  sessionExpiredReason: initialSessionExpiredReason,
}: {
  sessionExpiredReason?: SessionExpiredReason;
}) {
  const router = useRouter();

  const [provider, setProvider] = useState<PortalProvider>("CU12");
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [saveCu12Id, setSaveCu12Id] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedCu12Id = window.localStorage.getItem(SAVED_CU12_ID_STORAGE_KEY)?.trim() ?? "";
      if (!savedCu12Id) return;
      setCu12Id(savedCu12Id);
      setSaveCu12Id(true);
    } catch {
      // Ignore storage errors.
    }
  }, []);

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
    ? "로그인 요청을 처리하고 있습니다."
    : inviteSubmitting
      ? "초대 코드 확인을 처리하고 있습니다."
      : consentSubmitting
        ? "약관 동의를 처리하고 있습니다."
        : null;

  function clearConsentState() {
    setShowConsentModal(false);
    setConsentToken(null);
    setConsentPolicies([]);
    setPolicyChecks({});
    setConsentError(null);
  }

  function declineConsent() {
    clearConsentState();
    setError("필수 약관에 동의해야 서비스를 이용할 수 있습니다.");
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
          provider,
          cu12Id,
          cu12Password,
          campus,
          rememberSession: false,
        }),
      });

      if (!response.ok) {
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setError("서버 응답을 해석하지 못했습니다.");
          return;
        }
        setError(toLoginErrorMessage(payload ?? { error: resolveClientResponseError(response, payload, "Authentication failed.") }));
        return;
      }

      const payload = await readJsonBody<LoginResponse>(response);
      if (!payload) {
        setError("서버 응답이 비어 있습니다.");
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
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
      setError("로그인 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      setInviteError("초대 코드 인증 세션이 없습니다. 다시 로그인해 주세요.");
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
          rememberSession: false,
        }),
      });

      if (!response.ok) {
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setInviteError("서버 응답을 해석하지 못했습니다.");
          return;
        }

        const safePayload = payload ?? {
          error: resolveClientResponseError(response, payload, "Invite verification failed."),
        };
        const message = toInviteErrorMessage(safePayload);
        setInviteError(message);
        if (safePayload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setShowInviteModal(false);
          setChallengeToken(null);
          setError(message);
        }
        return;
      }

      const payload = await readJsonBody<AuthenticatedResponse | ConsentRequiredResponse>(response);
      if (!payload) {
        setInviteError("서버 응답이 비어 있습니다.");
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
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
      setInviteError("초대 코드 확인 중 오류가 발생했습니다.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function onSubmitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consentToken) {
      setConsentError("약관 동의 세션이 없습니다. 다시 로그인해 주세요.");
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
        let payload: ApiErrorResponse | null = null;
        try {
          payload = await readJsonBody<ApiErrorResponse>(response);
        } catch {
          setConsentError("서버 응답을 해석하지 못했습니다.");
          return;
        }

        const safePayload = payload ?? {
          error: resolveClientResponseError(response, payload, "Policy consent failed."),
        };
        const message = toConsentErrorMessage(safePayload);
        setConsentError(message);
        if (safePayload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          clearConsentState();
          setError(message);
        }
        return;
      }

      const payload = await readJsonBody<AuthenticatedResponse>(response);
      if (!payload) {
        setConsentError("서버 응답이 비어 있습니다.");
        return;
      }

      syncSavedCu12Id(saveCu12Id, cu12Id);
      applySessionPolicy(payload.session);
      clearConsentState();
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setConsentError("약관 동의 처리 중 오류가 발생했습니다.");
    } finally {
      setConsentSubmitting(false);
    }
  }

  return (
    <div className="login-form-shell">
      {sessionExpiredReason ? (
        <div className="session-timeout-banner">
          <p><strong>세션이 만료되어 로그아웃 되었습니다.</strong></p>
          <p>개인정보 보호 및 보안 강화를 위한 자동 로그아웃 정책에 따라 세션이 종료 되었습니다.</p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="form-stack">
        <p className="muted">
          가톨릭대학교 포털 계정으로 로그인하세요. 서비스 선택은 접속 대상만 구분하며 계정은 공통으로 연동됩니다.
        </p>

        <label className="field">
          <span>이용 서비스</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value as PortalProvider)}>
            {PROVIDER_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>포털 계정 ID</span>
          <input
            value={cu12Id}
            onChange={(event) => setCu12Id(event.target.value)}
            autoComplete="username"
            required
            minLength={4}
            placeholder="학번 또는 포털 계정"
          />
        </label>

        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            value={cu12Password}
            onChange={(event) => setCu12Password(event.target.value)}
            autoComplete="current-password"
            required
            minLength={4}
            placeholder="비밀번호"
          />
        </label>

        {provider === "CU12" ? (
          <label className="field">
            <span>교정 선택 (CU12 전용)</span>
            <select value={campus} onChange={(event) => setCampus(event.target.value as Campus)}>
              {CAMPUS_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="login-options-row">
          <label className="check-field">
            <input
              type="checkbox"
              checked={saveCu12Id}
              onChange={(event) => {
                const checked = event.target.checked;
                setSaveCu12Id(checked);
                if (!checked) {
                  syncSavedCu12Id(false, cu12Id);
                }
              }}
            />
            <span>ID 저장</span>
          </label>
          {provider === "CU12" ? (
            <a
              className="btn ghost-btn login-reset-link"
              href="https://www.cu12.ac.kr/el/member/pw_reset_form.acl"
              target="_blank"
              rel="noopener noreferrer"
            >
              비밀번호 초기화
            </a>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={submitting} className="btn btn-success">
          {submitting ? <Loader2 className="spin" size={16} /> : null}
          {submitting ? "처리 중..." : "로그인"}
        </button>
      </form>

      {showInviteModal ? (
        <div className="modal-overlay" role="presentation" onClick={() => !inviteSubmitting && setShowInviteModal(false)}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="초대 코드 입력"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>초대 코드 입력</h2>
            <p className="muted">관리자가 발급한 초대 코드를 입력해 주세요.</p>

            <form onSubmit={onSubmitInvite} className="form-stack">
              <label className="field">
                <span>초대 코드</span>
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required
                  minLength={8}
                  autoFocus
                  placeholder="ABCD-1234"
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
            <p className="muted">서비스 이용을 위해 필수 약관에 동의해 주세요.</p>

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
                    <span>{policy.title} 동의 (필수)</span>
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
                  onClick={declineConsent}
                  disabled={consentSubmitting}
                >
                  동의 거부
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
