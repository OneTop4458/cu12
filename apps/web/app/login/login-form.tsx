"use client";

import { FormEvent, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

type Campus = "SONGSIM" | "SONGSIN";

export function LoginForm() {
  const router = useRouter();
  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<Campus>("SONGSIM");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id,
          cu12Password,
          campus,
          inviteCode: inviteCode.trim() ? inviteCode.trim() : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; firstLogin?: boolean };
      if (!response.ok) {
        setError(payload.error ?? "로그인에 실패했습니다.");
        return;
      }

      if (payload.firstLogin) {
        setMessage("초대코드 검증이 완료되었습니다.");
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
    <form onSubmit={onSubmit} className="form-stack">
      <label className="field">
        <span>CU12 아이디</span>
        <input
          value={cu12Id}
          onChange={(event) => setCu12Id(event.target.value)}
          autoComplete="username"
          required
          minLength={4}
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
        />
      </label>

      <label className="field">
        <span>캠퍼스</span>
        <select
          value={campus}
          onChange={(event) => setCampus(event.target.value as Campus)}
        >
          <option value="SONGSIM">성심교정 (SONGSIM)</option>
          <option value="SONGSIN">성신교정 (SONGSIN)</option>
        </select>
      </label>

      <label className="field">
        <span>초대코드 (최초 1회만 필요)</span>
        <input
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          placeholder="처음 로그인 시에만 입력"
          minLength={8}
        />
      </label>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <button type="submit" disabled={submitting}>
        {submitting ? "로그인 중..." : "로그인"}
      </button>
    </form>
  );
}
