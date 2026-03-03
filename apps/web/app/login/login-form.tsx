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
        if (payload.errorCode === "CU12_AUTH_FAILED") {
          setError("CU12 login failed. Check your ID and password.");
        } else {
          setError(payload.error ?? "Login failed.");
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

      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      setInviteError("Session expired. Please log in again.");
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
          setInviteError("This CU12 ID is not approved. Contact an administrator.");
        } else if (payload.errorCode === "LOGIN_CHALLENGE_INVALID") {
          setInviteError("Session expired. Please log in again.");
          setShowInviteModal(false);
          setChallengeToken(null);
        } else {
          setInviteError(payload.error ?? "Invite verification failed.");
        }
        return;
      }

      setShowInviteModal(false);
      setChallengeToken(null);
      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setInviteError("Network error. Please try again.");
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
          />
        </label>

        <label className="field">
          <span>CU12 Password</span>
          <input
            type="password"
            value={cu12Password}
            onChange={(event) => setCu12Password(event.target.value)}
            autoComplete="current-password"
            required
            minLength={4}
          />
        </label>

        <label className="field">
          <span>Campus</span>
          <select
            value={campus}
            onChange={(event) => setCampus(event.target.value as Campus)}
          >
            <option value="SONGSIM">Songsim Campus (SONGSIM)</option>
            <option value="SONGSIN">Songsin Campus (SONGSIN)</option>
          </select>
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
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
            aria-label="Invite code verification"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Invite code required</h2>
            <p className="muted">
              CU12 credentials were verified. This account needs one-time invite verification.
            </p>

            <form onSubmit={onSubmitInvite} className="form-stack">
              <label className="field">
                <span>Invite code</span>
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required
                  minLength={8}
                  autoFocus
                />
              </label>

              {inviteError ? <p className="error-text">{inviteError}</p> : null}

              <div className="button-row">
                <button type="submit" disabled={inviteSubmitting}>
                  {inviteSubmitting ? "Verifying..." : "Verify"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowInviteModal(false)}
                  disabled={inviteSubmitting}
                >
                  Close
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}