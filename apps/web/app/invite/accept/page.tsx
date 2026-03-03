"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function InviteAcceptPage() {
  const router = useRouter();

  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenFromQuery = new URLSearchParams(window.location.search).get("token");
    if (tokenFromQuery) {
      setToken(tokenFromQuery);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "가입에 실패했습니다.");
        return;
      }

      router.push("/dashboard" as Route);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-main">
      <section className="card auth-card">
        <h1>초대 수락</h1>
        <p className="muted">
          관리자에게 받은 초대 토큰으로 계정을 생성합니다.
        </p>

        <form onSubmit={onSubmit} className="form-stack">
          <label className="field">
            <span>초대 토큰</span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              minLength={8}
            />
          </label>

          <label className="field">
            <span>이름</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "처리 중..." : "가입 및 로그인"}
          </button>
        </form>

        <p className="muted">
          이미 계정이 있으면 <Link href={"/login" as Route}>로그인</Link>
        </p>
      </section>
    </main>
  );
}
