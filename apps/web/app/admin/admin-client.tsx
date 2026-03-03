"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  isActive: boolean;
  createdAt: string;
  cu12Account: { accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR" } | null;
  mailPreference: {
    email: string;
    enabled: boolean;
    alertOnNotice: boolean;
    alertOnDeadline: boolean;
    alertOnAutolearn: boolean;
    digestEnabled: boolean;
    digestHour: number;
    updatedAt: string | null;
  } | null;
}

interface InviteItem {
  id: string;
  cu12Id: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  state: "ACTIVE" | "INACTIVE" | "USED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByEmail: string | null;
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

interface LogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

interface LogListResponse {
  logs: LogItem[];
  pagination: LogPagination;
}

const LOG_PAGE_LIMIT = 50;

function toDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

export function AdminClient({ initialUser }: AdminClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);

  const [context, setContext] = useState<SessionContext | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logPagination, setLogPagination] = useState<LogPagination | null>(null);
  const [latestToken, setLatestToken] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(1);

  const [inviteCu12Id, setInviteCu12Id] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "USER">("USER");
  const [inviteExpiresHours, setInviteExpiresHours] = useState(72);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const [newCu12Id, setNewCu12Id] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCampus, setNewCampus] = useState<"SONGSIM" | "SONGSIN">("SONGSIM");
  const [newRole, setNewRole] = useState<"ADMIN" | "USER">("USER");
  const [newIsTestUser, setNewIsTestUser] = useState(true);
  const [newIsActive, setNewIsActive] = useState(true);
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [mailTestUserId, setMailTestUserId] = useState<string | null>(null);

  const fetchJson = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(url, init);
      if (res.status === 401) {
        router.push("/login" as Route);
        throw new Error("Unauthorized");
      }
      const payload = (await res.json()) as T & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "요청 처리 중 오류가 발생했습니다.");
      return payload;
    },
    [router],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setBlockingMessage("처리 중...");
    setError(null);
    try {
      const [ctx, memberRes, inviteRes, logRes] = await Promise.all([
        fetchJson<SessionContext>("/api/session/context"),
        fetchJson<{ members: MemberItem[] }>("/api/admin/members?limit=300"),
        fetchJson<{ invites: InviteItem[] }>("/api/auth/invite"),
        fetchJson<LogListResponse>(`/api/admin/logs?page=${logPage}&limit=${LOG_PAGE_LIMIT}`),
      ]);
      setContext(ctx);
      setMembers(memberRes.members);
      setInvites(inviteRes.invites);
      setLogs(logRes.logs);
      setLogPagination(logRes.pagination);
      setLogPage(logRes.pagination.page);
    } catch (err) {
      if ((err as Error).message !== "Unauthorized") setError((err as Error).message);
    } finally {
      setLoading(false);
      setBlockingMessage((message) => (message === "처리 중..." ? null : message));
    }
  }, [fetchJson, logPage]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteSubmitting(true);
    setError(null);
    setBlockingMessage("초대 코드 발급 중...");

    try {
      const payload = await fetchJson<{ token: string; expiresAt: string }>("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id: inviteCu12Id,
          role: inviteRole,
          expiresHours: inviteExpiresHours,
          isActive: true,
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
      setBlockingMessage(null);
    }
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemberSubmitting(true);
    setBlockingMessage("회원 등록 중...");
    setError(null);

    try {
      await fetchJson("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id: newCu12Id,
          campus: newCampus,
          role: newRole,
          isTestUser: newIsTestUser,
          isActive: newIsActive,
          ...(newIsTestUser
            ? { localPassword: newPassword }
            : { cu12Password: newPassword }),
        }),
      });
      setNewCu12Id("");
      setNewPassword("");
      setMessage("회원 등록 완료");
      await refreshAll();
    } catch (err) {
      const text = (err as Error).message;
      if (text.includes("localPassword is required")) {
        setError("테스트 회원은 로컬 비밀번호를 입력해야 합니다.");
      } else if (text.includes("CU12 ID or password is invalid")) {
        setError("CU12 ID 또는 비밀번호가 올바르지 않습니다.");
      } else {
        setError(text);
      }
    } finally {
      setMemberSubmitting(false);
      setBlockingMessage(null);
    }
  }

  async function startImpersonation(member: MemberItem) {
    setBlockingMessage("관리자 권한으로 진입 중...");
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
    setBlockingMessage("임시로그인 종료 중...");
    try {
      await fetchJson("/api/admin/impersonation", { method: "DELETE" });
      setMessage("임시로그인 종료");
      await refreshAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
    }
  }

  async function toggleInvite(invite: InviteItem) {
    const nextState = invite.state === "INACTIVE";
    setBlockingMessage(nextState ? "초대 코드 활성화 중..." : "초대 코드 비활성화 중...");
    try {
      await fetchJson("/api/auth/invite", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteId: invite.id,
          isActive: nextState,
        }),
      });
      await refreshAll();
      setMessage(nextState ? "초대코드가 활성화되었습니다." : "초대코드가 비활성화되었습니다.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
    }
  }

  async function toggleMemberActive(member: MemberItem) {
    setBlockingMessage(member.isActive ? "회원 비활성화 중..." : "회원 활성화 중...");
    try {
      await fetchJson(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      await refreshAll();
      setMessage(`회원이 ${member.isActive ? "비활성화" : "활성화"} 되었습니다.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
    }
  }

  async function deactivateMember(member: MemberItem) {
    const ok = window.confirm("정말 탈퇴 처리(비활성화) 하시겠습니까?");
    if (!ok) return;
    setBlockingMessage("회원 탈퇴 처리 중...");
    try {
      await fetchJson(`/api/admin/members/${member.id}`, {
        method: "DELETE",
      });
      await refreshAll();
      setMessage("회원이 탈퇴 처리되었습니다.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
    }
  }

  async function sendTestMail(member: MemberItem) {
    setMailTestUserId(member.id);
    setError(null);
    setBlockingMessage("메일 테스트 발송 중...");
    try {
      const to = member.mailPreference?.email ?? member.email;
      await fetchJson(`/api/admin/members/${member.id}/mail-test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to,
          subject: "[CU12] 메일 수신 테스트",
        }),
      });
      setMessage(`${member.email} 메일 테스트 발송 요청 완료`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBlockingMessage(null);
      setMailTestUserId(null);
    }
  }

  const logPageButtons = useMemo(() => {
    const totalPages = logPagination?.totalPages ?? 1;
    const currentPage = logPagination?.page ?? 1;
    const maxButtons = 7;
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [logPagination?.page, logPagination?.totalPages]);

  const goToLogPage = useCallback(
    (page: number) => {
      const totalPages = logPagination?.totalPages ?? 1;
      const nextPage = Math.min(Math.max(page, 1), totalPages);
      setLogPage((previousPage) => (previousPage === nextPage ? previousPage : nextPage));
    },
    [logPagination?.totalPages],
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login" as Route);
    router.refresh();
  }

  return (
    <>
      <header className="page-header branded-header">
        <div>
          <p className="brand-kicker">CU12 자동화 - 관리자</p>
          <h1>관리자 대시보드</h1>
          <p className="muted">{initialUser.email}</p>
          {context?.impersonating ? <p className="error-text">현재 임시로그인 계정: {context.effective.email}</p> : null}
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => router.push("/dashboard" as Route)}>사용자 화면</button>
          <button className="ghost-btn" onClick={() => void refreshAll()} disabled={loading}>새로고침</button>
          {context?.impersonating ? <button className="ghost-btn" onClick={() => void stopImpersonation()}>임시로그인 종료</button> : null}
          <button onClick={logout}>로그아웃</button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="card">
        <h2>회원 생성</h2>
        <form onSubmit={createMember} className="form-grid top-gap">
          <label className="field">
            <span>CU12 ID 또는 로그인 ID</span>
            <input value={newCu12Id} onChange={(event) => setNewCu12Id(event.target.value)} required minLength={4} />
          </label>
          <label className="field">
            <span>{newIsTestUser ? "로컬 비밀번호" : "CU12 비밀번호"}</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={newIsTestUser ? 8 : 4}
            />
          </label>
          <label className="field">
            <span>캠퍼스</span>
            <select value={newCampus} onChange={(event) => setNewCampus(event.target.value as "SONGSIM" | "SONGSIN")}>
              <option value="SONGSIM">종합</option>
              <option value="SONGSIN">신학관</option>
            </select>
          </label>
          <label className="field">
            <span>권한</span>
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as "ADMIN" | "USER")}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={newIsTestUser} onChange={(event) => setNewIsTestUser(event.target.checked)} />
            <span>테스트 계정(로컬 로그인)</span>
          </label>
          <label className="check-field">
            <input type="checkbox" checked={newIsActive} onChange={(event) => setNewIsActive(event.target.checked)} />
            <span>즉시 활성화</span>
          </label>
          <div className="align-end">
            <button type="submit" disabled={memberSubmitting}>
              {memberSubmitting ? "등록 중..." : "회원 생성"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>회원 목록</h2>
        <div className="table-wrap">
          <table>
            <thead>
            <tr>
              <th>이메일</th>
              <th>권한</th>
              <th>상태</th>
              <th>타입</th>
              <th>CU12 연동</th>
              <th>메일 수신</th>
              <th>생성일</th>
              <th>작업</th>
            </tr>
            </thead>
            <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={8}>회원이 없습니다.</td>
              </tr>
            ) : members.map((member) => (
              <tr key={member.id}>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td>{member.isActive ? "활성" : "비활성"}</td>
                <td>{member.isTestUser ? "테스트" : "일반"}</td>
                <td>{member.cu12Account?.accountStatus ?? "-"}</td>
                <td>
                  {member.mailPreference
                    ? `${member.mailPreference.email} (${member.mailPreference.enabled ? "ON" : "OFF"})`
                    : "미설정"}
                </td>
                <td>{toDateTime(member.createdAt)}</td>
                <td>
                  <div className="action-row">
                    <button className="ghost-btn" onClick={() => void startImpersonation(member)}>회원 조회</button>
                    <button className="ghost-btn" onClick={() => void toggleMemberActive(member)}>
                      {member.isActive ? "비활성화" : "활성화"}
                    </button>
                    <button
                      className="ghost-btn"
                      onClick={() => void sendTestMail(member)}
                      disabled={mailTestUserId === member.id}
                    >
                      {mailTestUserId === member.id ? "테스트 중..." : "메일 테스트"}
                    </button>
                    <button className="ghost-btn" onClick={() => void deactivateMember(member)}>탈퇴</button>
                  </div>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
        {logPagination?.totalPages && logPagination.totalPages > 1 ? (
          <div className="pagination">
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goToLogPage((logPagination?.page ?? 1) - 1)}
              disabled={logPagination?.hasPrevPage === false}
            >
              이전
            </button>
            {logPageButtons.map((page) => (
              <button
                key={page}
                type="button"
                className={`pagination-button ghost-btn${(logPagination?.page ?? 1) === page ? " active" : ""}`}
                onClick={() => goToLogPage(page)}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goToLogPage((logPagination?.page ?? 1) + 1)}
              disabled={logPagination?.hasNextPage === false}
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>초대 코드 관리</h2>
        <form onSubmit={createInvite} className="form-grid top-gap">
          <label className="field">
            <span>CU12 ID</span>
            <input value={inviteCu12Id} onChange={(event) => setInviteCu12Id(event.target.value)} required minLength={4} />
          </label>
          <label className="field">
            <span>권한</span>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "USER")}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label className="field">
            <span>만료(시간)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={inviteExpiresHours}
              onChange={(event) => setInviteExpiresHours(Number(event.target.value))}
              required
            />
          </label>
          <div className="align-end">
            <button type="submit" disabled={inviteSubmitting}>
              {inviteSubmitting ? "발급 중..." : "초대코드 발급"}
            </button>
          </div>
        </form>
        {latestToken ? <p className="ok-text">발급된 초대코드: <code>{latestToken}</code></p> : null}

        <div className="table-wrap">
          <table>
            <thead>
            <tr>
              <th>CU12 ID</th>
              <th>권한</th>
              <th>상태</th>
              <th>생성일</th>
              <th>만료일</th>
              <th>사용일</th>
              <th>작업</th>
            </tr>
            </thead>
            <tbody>
            {invites.length === 0 ? (
              <tr>
                <td colSpan={7}>초대코드가 없습니다.</td>
              </tr>
            ) : invites.map((invite) => (
              <tr key={invite.id}>
                <td>{invite.cu12Id}</td>
                <td>{invite.role}</td>
                <td>{invite.state} / {invite.isActive ? "ON" : "OFF"}</td>
                <td>{toDateTime(invite.createdAt)}</td>
                <td>{invite.state === "USED" || invite.state === "EXPIRED" ? "-" : toDateTime(invite.expiresAt)}</td>
                <td>{toDateTime(invite.usedAt)}</td>
                <td>
                  <button className="ghost-btn" onClick={() => void toggleInvite(invite)}>
                    {invite.state === "INACTIVE" ? "활성화" : "비활성화"}
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>관리 로그</h2>
        <div className="table-wrap">
          <table>
            <thead>
            <tr><th>발생시간</th><th>카테고리</th><th>중요도</th><th>Actor</th><th>Target</th><th>메시지</th></tr>
            </thead>
            <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6}>로그가 없습니다.</td>
              </tr>
            ) : logs.map((log) => (
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
