"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

interface AdminClientProps {
  initialUser: { email: string; role: "ADMIN" };
}

interface SessionContext {
  actor: { userId: string; email: string; role: "ADMIN" | "USER" };
  effective: { userId: string; email: string; role: "ADMIN" | "USER" };
  impersonating: boolean;
}

interface MemberItem {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  isTestUser: boolean;
  createdAt: string;
  cu12Account: { accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR" } | null;
}

interface InviteItem {
  id: string;
  cu12Id: string;
  role: "ADMIN" | "USER";
  state: "ACTIVE" | "USED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

interface LogItem {
  id: string;
  category: string;
  severity: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
  actor: { email: string } | null;
  target: { email: string } | null;
}

function toDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

export function AdminClient({ initialUser }: AdminClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [context, setContext] = useState<SessionContext | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [latestToken, setLatestToken] = useState<string | null>(null);

  const [inviteCu12Id, setInviteCu12Id] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "USER">("USER");
  const [inviteExpiresHours, setInviteExpiresHours] = useState(72);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const [newCu12Id, setNewCu12Id] = useState("");
  const [newCu12Password, setNewCu12Password] = useState("");
  const [newCampus, setNewCampus] = useState<"SONGSIM" | "SONGSIN">("SONGSIM");
  const [newRole, setNewRole] = useState<"ADMIN" | "USER">("USER");
  const [newIsTestUser, setNewIsTestUser] = useState(true);
  const [memberSubmitting, setMemberSubmitting] = useState(false);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);
    if (res.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }
    const payload = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "요청 실패");
    return payload;
  }, [router]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ctx, memberRes, inviteRes, logRes] = await Promise.all([
        fetchJson<SessionContext>("/api/session/context"),
        fetchJson<{ members: MemberItem[] }>("/api/admin/members?limit=300"),
        fetchJson<{ invites: InviteItem[] }>("/api/auth/invite"),
        fetchJson<{ logs: LogItem[] }>("/api/admin/logs?limit=200"),
      ]);
      setContext(ctx);
      setMembers(memberRes.members);
      setInvites(inviteRes.invites);
      setLogs(logRes.logs);
    } catch (err) {
      if ((err as Error).message !== "Unauthorized") setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteSubmitting(true);
    setError(null);
    try {
      const payload = await fetchJson<{ token: string; expiresAt: string }>("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id: inviteCu12Id,
          role: inviteRole,
          expiresHours: inviteExpiresHours,
        }),
      });
      setLatestToken(payload.token);
      setInviteCu12Id("");
      setMessage(`초대코드 발급 완료 (만료: ${toDateTime(payload.expiresAt)})`);
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemberSubmitting(true);
    setBlockingMessage("회원을 생성하는 중입니다...");
    setError(null);
    try {
      await fetchJson("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id: newCu12Id,
          cu12Password: newCu12Password,
          campus: newCampus,
          role: newRole,
          isTestUser: newIsTestUser,
        }),
      });
      setNewCu12Id("");
      setNewCu12Password("");
      setMessage("회원 생성/갱신 완료");
      await refreshAll();
    } catch (err) {
      const text = (err as Error).message;
      if (text.includes("CU12 ID or password is invalid")) setError("가톨릭 공유대 계정 검증 실패");
      else setError(text);
    } finally {
      setMemberSubmitting(false);
      setBlockingMessage(null);
    }
  }

  async function startImpersonation(member: MemberItem) {
    setBlockingMessage("사용자 화면으로 전환 중...");
    try {
      await fetchJson("/api/admin/impersonation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: member.id }),
      });
      router.push("/dashboard" as Route);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBlockingMessage(null);
    }
  }

  async function stopImpersonation() {
    setBlockingMessage("대리 실행 종료 중...");
    try {
      await fetchJson("/api/admin/impersonation", { method: "DELETE" });
      setMessage("대리 실행 종료 완료");
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login" as Route);
    router.refresh();
  }

  return (
    <>
      <header className="page-header branded-header">
        <div>
          <p className="brand-kicker">가톨릭대학교 공유대학</p>
          <h1>관리자 운영 센터</h1>
          <p className="muted">{initialUser.email}</p>
          {context?.impersonating ? <p className="error-text">대리 실행 중: {context.effective.email}</p> : null}
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => void refreshAll()} disabled={loading}>새로고침</button>
          {context?.impersonating ? <button className="ghost-btn" onClick={() => void stopImpersonation()}>대리 종료</button> : null}
          <button onClick={logout}>로그아웃</button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="card">
        <h2>테스트/신규 회원 즉시 생성</h2>
        <form onSubmit={createMember} className="form-grid top-gap">
          <label className="field"><span>CU12 아이디</span><input value={newCu12Id} onChange={(event) => setNewCu12Id(event.target.value)} required minLength={4} /></label>
          <label className="field"><span>CU12 비밀번호</span><input type="password" value={newCu12Password} onChange={(event) => setNewCu12Password(event.target.value)} required minLength={4} /></label>
          <label className="field"><span>캠퍼스</span><select value={newCampus} onChange={(event) => setNewCampus(event.target.value as "SONGSIM" | "SONGSIN")}><option value="SONGSIM">성심</option><option value="SONGSIN">성신</option></select></label>
          <label className="field"><span>권한</span><select value={newRole} onChange={(event) => setNewRole(event.target.value as "ADMIN" | "USER")}><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label>
          <label className="check-field"><input type="checkbox" checked={newIsTestUser} onChange={(event) => setNewIsTestUser(event.target.checked)} /><span>테스트 회원</span></label>
          <div className="align-end"><button type="submit" disabled={memberSubmitting}>{memberSubmitting ? "처리 중..." : "회원 생성"}</button></div>
        </form>
      </section>

      <section className="card">
        <h2>회원 관리</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>이메일</th><th>권한</th><th>계정 상태</th><th>테스트</th><th>생성</th><th>동작</th></tr></thead>
            <tbody>
              {members.length === 0 ? <tr><td colSpan={6}>회원이 없습니다.</td></tr> : members.map((member) => (
                <tr key={member.id}>
                  <td>{member.email}</td>
                  <td>{member.role}</td>
                  <td>{member.cu12Account?.accountStatus ?? "-"}</td>
                  <td>{member.isTestUser ? "Y" : "N"}</td>
                  <td>{toDateTime(member.createdAt)}</td>
                  <td><button className="ghost-btn" onClick={() => void startImpersonation(member)}>사용자 화면 보기</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>초대코드 관리</h2>
        <form onSubmit={createInvite} className="form-grid top-gap">
          <label className="field"><span>대상 CU12 아이디</span><input value={inviteCu12Id} onChange={(event) => setInviteCu12Id(event.target.value)} required minLength={4} /></label>
          <label className="field"><span>권한</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "USER")}><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label>
          <label className="field"><span>유효 시간(시간)</span><input type="number" min={1} max={720} value={inviteExpiresHours} onChange={(event) => setInviteExpiresHours(Number(event.target.value))} required /></label>
          <div className="align-end"><button type="submit" disabled={inviteSubmitting}>{inviteSubmitting ? "발급 중..." : "초대코드 발급"}</button></div>
        </form>
        {latestToken ? <p className="ok-text">발급된 초대코드: <code>{latestToken}</code></p> : null}
        <div className="table-wrap">
          <table>
            <thead><tr><th>CU12 ID</th><th>권한</th><th>상태</th><th>생성</th><th>만료</th><th>사용</th></tr></thead>
            <tbody>
              {invites.length === 0 ? <tr><td colSpan={6}>초대코드가 없습니다.</td></tr> : invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.cu12Id}</td>
                  <td>{invite.role}</td>
                  <td>{invite.state}</td>
                  <td>{toDateTime(invite.createdAt)}</td>
                  <td>{invite.state === "USED" ? "-" : toDateTime(invite.expiresAt)}</td>
                  <td>{toDateTime(invite.usedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>운영 로그</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>시각</th><th>분류</th><th>등급</th><th>Actor</th><th>Target</th><th>메시지</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <tr><td colSpan={6}>로그가 없습니다.</td></tr> : logs.map((log) => (
                <tr key={log.id}>
                  <td>{toDateTime(log.createdAt)}</td>
                  <td>{log.category}</td>
                  <td>{log.severity}</td>
                  <td>{log.actor?.email ?? "-"}</td>
                  <td>{log.target?.email ?? "-"}</td>
                  <td>{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {blockingMessage ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>처리 중</h2>
            <p className="muted">{blockingMessage}</p>
            <div className="loading-bar"><span /></div>
          </section>
        </div>
      ) : null}
    </>
  );
}

