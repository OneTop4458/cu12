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
          setError("ID 또는 비밀번호가 잘못되었습니다.");
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setError("비밀번호가 잠금 처리되었거나 계정이 비활성화되었습니다.");
        } else if (payload.errorCode === "CU12_AUTH_FAILED") {
          setError("CU12 계정/비밀번호 인증에 실패했습니다.");
        } else {
          setError(payload.error ?? "로그인 요청을 처리하지 못했습니다.");
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

      router.push((payload.user.role === "ADMIN" ? "/admin" : "/dashboard") as Route);
      router.refresh();
    } catch {
      setError("네트워크 연결에 실패했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      setInviteError("초대 코드를 확인할 수 없습니다. 로그인 화면으로 돌아가 다시 시도하세요.");
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
          setInviteError("승인되지 않은 계정입니다. 관리자에게 계정 권한을 요청하세요.");
        } else if (payload.errorCode === "INVITE_CODE_INVALID") {
          setInviteError("초대 코드가 유효하지 않습니다.");
        } else if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setInviteError("초대 코드 인증 정보가 유효하지 않습니다. 다시 로그인해 주세요.");
          setShowInviteModal(false);
          setChallengeToken(null);
        } else if (payload.errorCode === "ACCOUNT_DISABLED") {
          setInviteError("계정이 비활성화되어 초대 검증이 차단됩니다.");
        } else {
          setInviteError(payload.error ?? "초대 코드 처리에 실패했습니다.");
        }
        return;
      }

      const payload = (await response.json()) as AuthenticatedResponse;
      setShowInviteModal(false);
      setChallengeToken(null);
      router.push((payload.user.role === "ADMIN" ? "/admin" : "/dashboard") as Route);
      router.refresh();
    } catch {
      setInviteError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="form-stack">
        <label className="field">
          <span>CU12 ID</span>
          <input
            value={cu12Id}
            onChange={(event) => setCu12Id(event.target.value)}
            autoComplete="username"
            required
            minLength={4}
            placeholder="ID를 입력하세요"
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
            <option value="SONGSIM">상명 캠퍼스(SONGSIM)</option>
            <option value="SONGSIN">상일 캠퍼스(SONGSIN)</option>
          </select>
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={submitting} className="btn btn-success">
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
            aria-label="초대 코드 입력"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>초대 코드 입력</h2>
            <p className="muted">
              초대 코드 8자리 이상을 입력한 뒤 완료를 눌러 인증을 진행하세요.
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
                  {inviteSubmitting ? "처리 중..." : "인증"}
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