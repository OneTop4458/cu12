"use client";

import { FormEvent, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type Campus = "SONGSIM" | "SONGSIN";

interface AuthenticatedResponse {
  stage: "AUTHENTICATED";
  user: {
    userId: string;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
  session?: {
    rememberSession: boolean;
    sessionMaxAgeSeconds: number;
    idleMaxAgeSeconds: number;
  };
}

interface InviteRequiredResponse {
  stage: "INVITE_REQUIRED";
  challengeToken: string;
}

interface ApiErrorResponse {
  error?: string;
  errorCode?: string;
}

const CAMPUS_OPTIONS: Array<{ value: Campus; label: string }> = [
  { value: "SONGSIM", label: "성심교정" },
  { value: "SONGSIN", label: "성신교정" },
];
const IDLE_TIMEOUT_STORAGE_KEY = "cu12:session-idle-timeout-ms";

function applySessionPolicy(policy: AuthenticatedResponse["session"]) {
  if (typeof window === "undefined") return;
  if (!policy || !Number.isFinite(policy.idleMaxAgeSeconds) || policy.idleMaxAgeSeconds <= 0) return;
  const timeoutMs = Math.max(1000, Math.trunc(policy.idleMaxAgeSeconds * 1000));
  try {
    window.localStorage.setItem(IDLE_TIMEOUT_STORAGE_KEY, String(timeoutMs));
  } catch {
    // Ignore storage errors.
  }
}

export function LoginForm() {
  const router = useRouter();
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [rememberSession, setRememberSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const isProcessing = submitting || inviteSubmitting;
  const processingMessage = submitting
    ? "로그인 요청 처리 중..."
    : inviteSubmitting
      ? "초대 코드 확인 처리 중..."
      : null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setInviteError(null);

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
        if (payload.errorCode === "LOCAL_AUTH_FAILED") {
          setError("ID 또는 비밀번호가 일치하지 않습니다.");
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setError("계정이 비활성 상태입니다. 관리자에게 활성화를 요청해 주세요.");
        } else if (payload.errorCode === "CU12_AUTH_FAILED") {
          setError("CU12 ID/비밀번호 인증에 실패했습니다.");
        } else {
          setError(payload.error ?? "로그인 처리에 실패했습니다.");
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse | InviteRequiredResponse;

      if (payload.stage === "INVITE_REQUIRED") {
        setChallengeToken(payload.challengeToken);
        setInviteCode("");
        setShowInviteModal(true);
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
      setInviteError("초대 코드 상태를 확인할 수 없습니다. 로그인 동작을 다시 시작하세요.");
      return;
    }

    setInviteSubmitting(true);
    setInviteError(null);

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
        if (payload.errorCode === "UNAPPROVED_ID") {
          setInviteError("승인되지 않은 ID입니다. 운영자에게 계정 생성 권한을 문의하세요.");
        } else if (payload.errorCode === "INVITE_CODE_INVALID") {
          setInviteError("초대 코드가 유효하지 않습니다.");
        } else if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setInviteError("초대 코드가 유효하지 않습니다. 새로고침 후 다시 로그인해 주세요.");
          setShowInviteModal(false);
          setChallengeToken(null);
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setInviteError("계정이 비활성 상태입니다. 관리자에게 계정 복구를 요청하세요.");
        } else {
          setInviteError(payload.error ?? "초대 코드 처리에 실패했습니다.");
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse;
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

  return (
    <div className="login-form-shell">
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
              초대 코드를 가지고 계시다면 8자리 이상의 코드를 그대로 입력하고 확인 버튼을 눌러주세요.
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

      {isProcessing ? (
        <div className="processing-overlay" role="presentation" aria-live="polite" aria-busy={isProcessing}>
          <section className="modal-card processing-card">
            <h2>처리 중</h2>
            <p className="muted">{processingMessage}</p>
            <div className="loading-bar"><span /></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
