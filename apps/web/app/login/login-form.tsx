"use client";

import { FormEvent, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

type Campus = "SONGSIM" | "SONGSIN";

interface AuthenticatedResponse {
  stage: "AUTHENTICATED";
  user: {
    userId: string;
    cu12Id: string;
    role: "ADMIN" | "USER";
  };
  firstLogin: boolean;
}

interface InviteRequiredResponse {
  stage: "INVITE_REQUIRED";
  challengeToken: string;
}

interface ApiErrorResponse {
  error?: string;
  errorCode?: string;
}

export function LoginForm() {
  const router = useRouter();
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        if (payload.errorCode === "LOCAL_AUTH_FAILED") {
          setError("로컬 계정 비밀번호가 일치하지 않습니다.");
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setError("비활성화된 계정입니다. 관리자에게 문의하세요.");
        } else if (payload.errorCode === "CU12_AUTH_FAILED") {
          setError("가톨릭 공유대 아이디 또는 비밀번호가 일치하지 않습니다.");
        } else {
          setError(payload.error ?? "로그인 처리 중 오류가 발생했습니다.");
        }
        return;
      }

      const payload = (await response.json()) as
        | AuthenticatedResponse
        | InviteRequiredResponse;

      if (payload.stage === "INVITE_REQUIRED") {
        setChallengeToken(payload.challengeToken);
        setInviteCode("");
        setShowInviteModal(true);
        return;
      }

      router.push((payload.user.role === "ADMIN" ? "/admin" : "/dashboard") as Route);
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
      setInviteError("인증 세션이 만료되었습니다. 다시 로그인해 주세요.");
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
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as ApiErrorResponse;
        if (payload.errorCode === "UNAPPROVED_ID") {
          setInviteError("승인되지 않은 아이디입니다. 관리자에게 승인 요청해 주세요.");
        } else if (payload.errorCode === "INVITE_CODE_INVALID") {
          setInviteError("초대 코드가 유효하지 않거나 만료되었습니다.");
        } else if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setInviteError("인증 세션이 만료되었습니다. 다시 로그인해 주세요.");
          setShowInviteModal(false);
          setChallengeToken(null);
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setInviteError("계정이 비활성화되었습니다. 관리자에게 문의하세요.");
        } else {
          setInviteError(payload.error ?? "초대 코드 인증에 실패했습니다.");
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse;
      setShowInviteModal(false);
      setChallengeToken(null);
      router.push((payload.user.role === "ADMIN" ? "/admin" : "/dashboard") as Route);
      router.refresh();
    } catch {
      setInviteError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="form-stack">
        <label className="field">
          <span>가톨릭 공유대 아이디</span>
          <input
            value={cu12Id}
            onChange={(event) => setCu12Id(event.target.value)}
            autoComplete="username"
            required
            minLength={4}
            placeholder="아이디 입력"
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
            placeholder="비밀번호 입력"
          />
        </label>

        <label className="field">
          <span>캠퍼스</span>
          <select
            value={campus}
            onChange={(event) => setCampus(event.target.value as Campus)}
          >
            <option value="SONGSIM">성심캠퍼스 (SONGSIM)</option>
            <option value="SONGSIN">성신캠퍼스 (SONGSIN)</option>
          </select>
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? "로그인 중..." : "로그인"}
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
            aria-label="초대 코드 인증"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>초대 코드 인증</h2>
            <p className="muted">
              최초 1회만 초대 코드를 입력하면 이후에는 가톨릭 공유대 로그인만으로 접속됩니다.
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
                  placeholder="초대 코드 입력"
                />
              </label>

              {inviteError ? <p className="error-text">{inviteError}</p> : null}

              <div className="button-row">
                <button type="submit" disabled={inviteSubmitting}>
                  {inviteSubmitting ? "확인 중..." : "인증 완료"}
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
    </>
  );
}
