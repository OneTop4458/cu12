"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { NotificationCenter } from "../../components/notifications/notification-center";
import { ThemeToggle } from "../../components/theme/theme-toggle";
import { UserMenu } from "../../components/layout/user-menu";

type RoleType = "ADMIN" | "USER";
type CampusType = "SONGSIM" | "SONGSIN";
type InviteState = "ACTIVE" | "USED" | "EXPIRED" | "INACTIVE";

interface AdminClientProps {
  initialUser: {
    email: string;
    role: RoleType;
  };
}

interface SessionActor {
  userId: string;
  email: string;
  role: RoleType;
}

interface SessionContext {
  actor: SessionActor;
  effective: SessionActor;
  impersonating: boolean;
}

interface MailPreference {
  email: string;
  enabled: boolean;
}

interface Cu12Account {
  cu12Id: string;
  campus: CampusType;
  accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR";
  statusReason: string | null;
}

interface Member {
  id: string;
  email: string;
  role: RoleType;
  name: string | null;
  isActive: boolean;
  isTestUser: boolean;
  createdAt: string;
  cu12Account: Cu12Account | null;
  mailPreference: MailPreference | null;
}

interface Invite {
  id: string;
  cu12Id: string;
  role: RoleType;
  isActive: boolean;
  state: InviteState;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByEmail?: string | null;
}

interface AdminLog {
  id: string;
  createdAt: string;
  category: string;
  severity: string;
  actor: {
    email: string;
  } | null;
  target: {
    email: string;
  } | null;
  message: string;
}

interface LogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

interface ApiErrorPayload {
  error?: string;
  errorCode?: string;
}

interface MembersPayload {
  members: Member[];
}

interface InvitesPayload {
  invites: Invite[];
}

interface LogsPayload {
  logs: AdminLog[];
  pagination: LogPagination;
}

interface InviteCreateResponse {
  inviteId: string;
  token: string;
  expiresAt: string;
}

interface InviteDeleteResponse {
  deleted: boolean;
  inviteId: string;
}

interface InviteToggleResponse {
  invite: Pick<Invite, "id" | "cu12Id" | "isActive" | "expiresAt" | "usedAt">;
}

interface MemberCreateResponse {
  created: boolean;
}

interface MemberUpdateResponse {
  updated: boolean;
  user: Member;
}

interface AdminNotification {
  id: string;
  courseTitle: string;
  message: string;
  occurredAt: string | null;
  createdAt: string;
  isUnread: boolean;
}

const LOGS_PAGE_SIZE = 25;

function parseError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const maybeError = (payload as ApiErrorPayload).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError.trim();
    }
  }
  return "요청을 처리하는 중 알 수 없는 오류가 발생했습니다.";
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}
function toDateTime(value: string | null): string {
  return formatDateTime(value);
}

function statusChipClassForInvite(state: InviteState) {
  switch (state) {
    case "ACTIVE":
      return "status-used";
    case "USED":
      return "status-active";
    case "EXPIRED":
      return "status-expired";
    case "INACTIVE":
    default:
      return "status-failed";
  }
}

function statusChipClassForMember(isActive: boolean) {
  return isActive ? "status-active" : "status-failed";
}

export function AdminClient({ initialUser }: AdminClientProps) {
  const router = useRouter();

  const [context, setContext] = useState<SessionContext>({
    actor: { userId: "-", email: initialUser.email, role: initialUser.role },
    effective: { userId: "-", email: initialUser.email, role: initialUser.role },
    impersonating: false,
  });

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [logPagination, setLogPagination] = useState<LogPagination | null>(null);

  const [loading, setLoading] = useState(true);
  const [blockingMessage, setBlockingMessage] = useState<string | null>("처리 중");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [mailTestUserId, setMailTestUserId] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [activeNotification, setActiveNotification] = useState<AdminNotification | null>(null);

  const [newCu12Id, setNewCu12Id] = useState("");
  const [newName, setNewName] = useState("");
  const [newCampus, setNewCampus] = useState<CampusType>("SONGSIM");
  const [newRole, setNewRole] = useState<RoleType>("USER");
  const [newIsTestUser, setNewIsTestUser] = useState(false);
  const [newIsActive, setNewIsActive] = useState(true);
  const [newCu12Password, setNewCu12Password] = useState("");
  const [newLocalPassword, setNewLocalPassword] = useState("");
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);

  const [inviteCu12Id, setInviteCu12Id] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleType>("USER");
  const [inviteExpiresHours, setInviteExpiresHours] = useState(72);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [latestToken, setLatestToken] = useState<string | null>(null);
  const isEditMode = editingMemberId !== null;
  const originalEditModeIsTestUser = editingMember?.isTestUser ?? false;

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (response.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      throw new Error(parseError(payload));
    }

    return payload;
  }, [router]);

  const withBlocking = useCallback(async <T,>(text: string, task: () => Promise<T>): Promise<T | null> => {
    setBlockingMessage(text);
    setError(null);
    try {
      return await task();
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.";
      if (messageText !== "Unauthorized") {
        setError(messageText);
      }
      return null;
    } finally {
      setBlockingMessage(null);
    }
  }, []);

  const refreshAll = useCallback(async (page = 1, silent = false) => {
    const safePage = Math.max(1, Math.floor(page));
    if (!silent) {
      setLoading(true);
      setBlockingMessage("관리자 데이터 조회 중...");
    }
    setError(null);

    try {
      const [contextPayload, membersPayload, invitesPayload, logsPayload] = await Promise.all([
        fetchJson<SessionContext>("/api/session/context"),
        fetchJson<MembersPayload>("/api/admin/members"),
        fetchJson<InvitesPayload>("/api/auth/invite"),
        fetchJson<LogsPayload>(`/api/admin/logs?page=${safePage}&limit=${LOGS_PAGE_SIZE}`),
      ]);

      setContext(contextPayload);
      setMembers(Array.isArray(membersPayload.members) ? membersPayload.members : []);
      setInvites(Array.isArray(invitesPayload.invites) ? invitesPayload.invites : []);
      setLogs(Array.isArray(logsPayload.logs) ? logsPayload.logs : []);
      setLogPagination(logsPayload.pagination ?? null);
      setLogPage(logsPayload.pagination?.page ?? safePage);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "관리자 데이터를 불러오지 못했습니다.";
      if (messageText !== "Unauthorized") {
        setError(messageText);
        setMembers([]);
        setInvites([]);
        setLogs([]);
        setLogPagination(null);
      }
    } finally {
      setLoading(false);
      if (!silent) {
        setBlockingMessage(null);
      }
      setLogBusy(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    void refreshAll(1, false);
  }, [refreshAll]);

  const runAfterMutation = useCallback((page: number) => {
    void refreshAll(page, true);
  }, [refreshAll]);

  const logout = useCallback(() => {
    void withBlocking("로그아웃 처리 중...", async () => {
      await fetchJson("/api/auth/logout", { method: "POST" });
      router.push("/login" as Route);
    });
  }, [fetchJson, withBlocking, router]);

  const goDashboard = useCallback(() => {
    router.push("/dashboard" as Route);
  }, [router]);

  const refreshNow = useCallback(() => {
    void refreshAll(logPage, false);
  }, [logPage, refreshAll]);

  const stopImpersonation = useCallback(() => {
    if (!context.impersonating) return;
    void withBlocking("대리 접속 종료 처리 중...", async () => {
      await fetchJson("/api/admin/impersonation", { method: "DELETE" });
      await refreshAll(logPage, true);
      setMessage("대리 접속이 종료되었습니다.");
    });
  }, [context.impersonating, fetchJson, logPage, refreshAll, withBlocking]);

  const startImpersonation = useCallback((member: Member) => {
    void withBlocking(`${member.email} 계정으로 대리 접속 중...`, async () => {
      await fetchJson("/api/admin/impersonation", {
        method: "POST",
        body: JSON.stringify({ targetUserId: member.id }),
      });
      await refreshAll(logPage, true);
      setMessage(`현재 ${member.email} 계정 대리 접속 중입니다.`);
    });
  }, [fetchJson, logPage, refreshAll, withBlocking]);

  const resetMemberForm = useCallback(() => {
    setEditingMemberId(null);
    setEditingMember(null);
    setNewCu12Id("");
    setNewName("");
    setNewCampus("SONGSIM");
    setNewRole("USER");
    setNewIsTestUser(false);
    setNewIsActive(true);
    setNewCu12Password("");
    setNewLocalPassword("");
  }, []);

  const startEditMember = useCallback((member: Member) => {
    setEditingMemberId(member.id);
    setEditingMember(member);
    setNewCu12Id(member.cu12Account?.cu12Id ?? member.email);
    setNewName(member.name ?? "");
    setNewCampus(member.cu12Account?.campus ?? "SONGSIM");
    setNewRole(member.role);
    setNewIsTestUser(member.isTestUser);
    setNewIsActive(member.isActive);
    setNewCu12Password("");
    setNewLocalPassword("");
    setMessage(`${member.email} 회원 정보를 수정해주세요.`);
  }, []);

  const cancelEditMember = useCallback(() => {
    resetMemberForm();
    setMessage("회원 수정이 취소되었습니다.");
  }, [resetMemberForm]);

  const createMember = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (memberSubmitting) return;

    if (newIsTestUser && (!isEditMode || !originalEditModeIsTestUser) && !newLocalPassword.trim()) {
      setError("테스트 계정은 테스트용 비밀번호를 입력해 주세요.");
      return;
    }
    if (!isEditMode && !newIsTestUser && !newCu12Password.trim()) {
      setError("CU12 계정은 CU12 비밀번호를 입력해 주세요.");
      return;
    }

    const trimmedCu12Id = newCu12Id.trim();
    if (!trimmedCu12Id) return;

    setMemberSubmitting(true);
    const result = await withBlocking(
      isEditMode ? "회원 정보 수정 중..." : "회원 등록 중...",
      async () => {
        if (isEditMode && editingMemberId) {
          const patchPayload: Record<string, unknown> = {
            role: newRole,
            isTestUser: newIsTestUser,
            isActive: newIsActive,
          };
          const trimmedName = newName.trim();
          if (trimmedName) {
            patchPayload.name = trimmedName;
          }
          if (newIsTestUser && newLocalPassword.trim()) {
            patchPayload.localPassword = newLocalPassword.trim();
          }

          const payload = await fetchJson<MemberUpdateResponse>(`/api/admin/members/${editingMemberId}`, {
            method: "PATCH",
            body: JSON.stringify(patchPayload),
          });
          setMessage(payload.updated ? "회원 정보를 갱신했습니다." : "회원 수정이 반영되지 않았습니다.");
          return payload;
        }

        const payload = await fetchJson<MemberCreateResponse>("/api/admin/members", {
          method: "POST",
          body: JSON.stringify({
            cu12Id: trimmedCu12Id,
            cu12Password: newCu12Password.trim(),
            name: newName.trim() || undefined,
            campus: newCampus,
            role: newRole,
            isTestUser: newIsTestUser,
            isActive: newIsActive,
          }),
        });

        setMessage(payload.created ? "회원 등록을 완료했습니다." : "회원 정보를 갱신했습니다.");
        return payload;
      },
    );

    setMemberSubmitting(false);
    if (result) {
      resetMemberForm();
      runAfterMutation(logPage);
    }
  }, [
    fetchJson,
    memberSubmitting,
    newCu12Id,
    newName,
    newCampus,
    newRole,
    newIsTestUser,
    newIsActive,
    newCu12Password,
    newLocalPassword,
    logPage,
    runAfterMutation,
    withBlocking,
    resetMemberForm,
    isEditMode,
    editingMemberId,
    originalEditModeIsTestUser,
  ]);

  const toggleMemberActive = useCallback((member: Member) => {
    if (memberBusyId) return;

    setMemberBusyId(member.id);
    void withBlocking(member.isActive ? "회원 비활성 처리 중..." : "회원 활성화 처리 중...", async () => {
      await fetchJson(`/api/admin/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !member.isActive }),
      });
      setMessage(member.isActive ? "회원이 비활성화되었습니다." : "회원이 활성화되었습니다.");
      await refreshAll(logPage, true);
    }).finally(() => {
      setMemberBusyId(null);
    });
  }, [fetchJson, logPage, refreshAll, withBlocking, memberBusyId]);

  const sendTestMail = useCallback((member: Member) => {
    if (mailTestUserId) return;
    setMailTestUserId(member.id);

    void withBlocking("테스트 메일 발송 처리 중...", async () => {
      await fetchJson(`/api/admin/members/${member.id}/mail-test`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(`${member.email}에게 테스트 메일이 발송되었습니다.`);
      await refreshAll(logPage, true);
    }).finally(() => {
      setMailTestUserId(null);
    });
  }, [fetchJson, logPage, refreshAll, withBlocking, mailTestUserId]);

  const deactivateMember = useCallback((member: Member) => {
    if (memberBusyId) return;
    if (member.id === context.actor.userId) {
      setError("본인 계정은 탈퇴할 수 없습니다.");
      return;
    }
    if (!window.confirm(`${member.email} 계정을 탈퇴 처리할까요?`)) return;

    setMemberBusyId(member.id);
    void withBlocking("회원 탈퇴 처리 중...", async () => {
      await fetchJson(`/api/admin/members/${member.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: "관리자 요청에 따른 계정 탈퇴 처리" }),
      });
      setMessage(`${member.email} 계정 탈퇴가 완료되었습니다.`);
      await refreshAll(logPage, true);
    }).finally(() => {
      setMemberBusyId(null);
    });
  }, [context.actor.userId, fetchJson, logPage, refreshAll, withBlocking, memberBusyId]);

  const createInvite = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviteSubmitting) return;
    if (!inviteCu12Id.trim()) return;

    setInviteSubmitting(true);
    const result = await withBlocking("초대 코드 생성 중...", async () => {
      const payload = await fetchJson<InviteCreateResponse>("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({
          cu12Id: inviteCu12Id.trim(),
          role: inviteRole,
          expiresHours: inviteExpiresHours,
          isActive: true,
        }),
      });
      setLatestToken(payload.token);
      setMessage("초대 코드가 생성되었습니다.");
      return payload;
    });

    setInviteSubmitting(false);
    if (result) {
      setInviteCu12Id("");
      runAfterMutation(logPage);
    }
  }, [
    fetchJson,
    inviteSubmitting,
    inviteCu12Id,
    inviteRole,
    inviteExpiresHours,
    logPage,
    runAfterMutation,
    withBlocking,
  ]);

  const copyInviteToken = useCallback(async () => {
    if (!latestToken) return;
    if (!navigator.clipboard) {
      setError("클립보드 API를 사용할 수 없습니다.");
      return;
    }
    await navigator.clipboard.writeText(latestToken);
    setMessage("초대 코드가 클립보드에 복사되었습니다.");
  }, [latestToken]);

  const toggleInvite = useCallback((invite: Invite) => {
    if (inviteBusyId) return;

    setInviteBusyId(invite.id);
    const next = !invite.isActive;
    void withBlocking(`${next ? "초대 코드 활성화" : "초대 코드 비활성화"} 처리 중...`, async () => {
      await fetchJson<InviteToggleResponse>("/api/auth/invite", {
        method: "PATCH",
        body: JSON.stringify({ inviteId: invite.id, isActive: next }),
      });
      setMessage(`${invite.cu12Id} 초대 코드가 ${next ? "활성화" : "비활성화"}되었습니다.`);
      await refreshAll(logPage, true);
    }).finally(() => {
      setInviteBusyId(null);
    });
  }, [fetchJson, logPage, refreshAll, withBlocking, inviteBusyId]);

  const deleteInvite = useCallback((invite: Invite) => {
    if (inviteBusyId) return;
    if (!window.confirm(`${invite.cu12Id} 초대 코드를 삭제할까요?`)) return;

    setInviteBusyId(invite.id);
    void withBlocking("초대 코드 삭제 처리 중...", async () => {
      await fetchJson<InviteDeleteResponse>("/api/auth/invite", {
        method: "DELETE",
        body: JSON.stringify({ inviteId: invite.id }),
      });
      setMessage(`${invite.cu12Id} 초대 코드가 삭제되었습니다.`);
      await refreshAll(logPage, true);
    }).finally(() => {
      setInviteBusyId(null);
    });
  }, [fetchJson, inviteBusyId, logPage, refreshAll, withBlocking]);

  const goToLogPage = useCallback((page: number) => {
    if (!logPagination || loading || logBusy) return;
    const safePage = Math.max(1, Math.min(page, logPagination.totalPages || 1));
    setLogPage(safePage);
    setLogBusy(true);
    void refreshAll(safePage, true);
  }, [logPagination, loading, logBusy, refreshAll]);

  const logPageButtons = useMemo(() => {
    const current = logPagination?.page ?? 1;
    const total = logPagination?.totalPages ?? 1;
    if (total <= 1) return [];

    const maxButtons = 7;
    const half = Math.floor(maxButtons / 2);
    let start = current - half;
    let end = current + half;

    if (start < 1) {
      end += 1 - start;
      start = 1;
    }
    if (end > total) {
      start -= end - total;
      end = total;
    }

    const safeStart = Math.max(1, start);
    const safeEnd = Math.min(total, end);
    return Array.from({ length: safeEnd - safeStart + 1 }, (_, index) => safeStart + index);
  }, [logPagination]);

  const activeMemberCount = useMemo(() => members.filter((member) => member.isActive).length, [members]);
  const testMemberCount = useMemo(() => members.filter((member) => member.isTestUser).length, [members]);
  const recentLogNotifications = useMemo(
    () =>
      logs.map((log) => ({
        id: log.id,
        courseTitle: log.severity,
        message: `[${log.category}] ${log.actor?.email ?? "-"} => ${log.target?.email ?? "-"} / ${log.message}`,
        occurredAt: log.createdAt,
        createdAt: log.createdAt,
        isUnread: false,
      })),
    [logs],
  );

  return (
    <main className="dashboard-main page-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img
            src="/brand/catholic/crest-mark.png"
            alt="Catholic University crest"
            loading="lazy"
          />
          <div>
            <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션</p>
            <h1>운영 관리센터</h1>
            <div className="topbar-stats">
              <span className="action-kicker">현재 운영자: {context.effective.email}</span>
              {context.impersonating ? (
                <span className="error-text">대리접속 중: {context.actor.email} → {context.effective.email}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            type="button"
            onClick={() => void refreshAll(logPage, false)}
            disabled={loading || !!blockingMessage}
            title="새로고침"
          >
            <RotateCw size={16} />
          </button>
          <Link className="ghost-btn" href={"/admin/site-notices" as any}>
            공지/점검 설정
          </Link>
          <ThemeToggle />
          <NotificationCenter
            notifications={recentLogNotifications}
            onOpen={(item) => setActiveNotification(item)}
            onMarkRead={() => {}}
          />
          <UserMenu
            email={context.effective.email}
            role={initialUser.role}
            impersonating={context.impersonating}
            onDashboard={() => goDashboard()}
            onOpenSettings={undefined}
            onLogout={logout}
          />
        </div>
      </header>
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">가톨릭대학교 공유대학 수강 지원 솔루션 관리자</p>
          <h1>운영 관리센터</h1>
          <p className="text-small muted">
            회원 {members.length}명, 초대 코드 {invites.length}개, 로그 {logPagination?.total ?? 0}건
          </p>
        </div>
      </section>

      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>전체 회원</h2>
          <p className="metric">{members.length}명</p>
          <p className="muted">활성 {activeMemberCount}명</p>
        </article>
        <article className="admin-stat card">
          <h2>테스트 계정</h2>
          <p className="metric">{testMemberCount}명</p>
          <p className="muted">운영 배포 제외 계정</p>
        </article>
        <article className="admin-stat card">
          <h2>초대 코드</h2>
          <p className="metric">{invites.length}개</p>
          <p className="muted">활성 {invites.filter((invite) => invite.isActive).length}개</p>
        </article>
        <article className="admin-stat card">
          <h2>로그 페이지</h2>
          <p className="metric">{logPagination?.totalPages ?? 0}</p>
          <p className="muted">페이지 단위</p>
        </article>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="card">
        <div className="table-toolbar">
          <h2>{isEditMode ? "회원 정보 수정" : "회원 등록"}</h2>
          <span className="text-small muted">
            {isEditMode ? "목록에서 선택한 회원 정보를 수정합니다." : "신규 사용자 등록 또는 기존 계정 갱신"}
          </span>
        </div>
        <form className="form-grid top-gap" onSubmit={createMember}>
          <label className="field">
            <span>CU12 ID</span>
            <input
              value={newCu12Id}
              onChange={(event) => setNewCu12Id(event.target.value)}
              minLength={4}
              readOnly={isEditMode}
              required
              placeholder="예: student1234"
            />
          </label>
          <label className="field">
            <span>이름</span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={80}
              placeholder="표시될 이름 (선택)"
            />
          </label>
          <label className="field">
            <span>캠퍼스</span>
            <select
              value={newCampus}
              onChange={(event) => setNewCampus(event.target.value as CampusType)}
              disabled={isEditMode}
            >
              <option value="SONGSIM">SONGSIM</option>
              <option value="SONGSIN">SONGSIN</option>
            </select>
            {isEditMode ? (
              <p className="muted text-small">캠퍼스는 등록 후 별도 API에서 별도 수정하세요.</p>
            ) : null}
          </label>
          <label className="field">
            <span>역할</span>
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as RoleType)}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label className="field">
            <span>회원 구분</span>
            <select
              value={newIsTestUser ? "true" : "false"}
              onChange={(event) => setNewIsTestUser(event.target.value === "true")}
            >
              <option value="false">실서비스 계정</option>
              <option value="true">테스트 계정</option>
            </select>
          </label>
          <label className="field">
            <span>계정 상태</span>
            <select
              value={newIsActive ? "true" : "false"}
              onChange={(event) => setNewIsActive(event.target.value === "true")}
            >
              <option value="true">활성</option>
              <option value="false">비활성</option>
            </select>
          </label>
          {newIsTestUser ? (
            <label className="field">
              <span>테스트 비밀번호</span>
              <input
                type="password"
                value={newLocalPassword}
                onChange={(event) => setNewLocalPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
          ) : (
            <>
              {isEditMode ? (
                <p className="muted">CU12 비밀번호는 이 화면에서 수정할 수 없습니다.</p>
              ) : (
                <label className="field">
                  <span>CU12 비밀번호</span>
                  <input
                    type="password"
                    value={newCu12Password}
                    onChange={(event) => setNewCu12Password(event.target.value)}
                    minLength={4}
                    required
                  />
                </label>
              )}
            </>
          )}
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={memberSubmitting}>
              {memberSubmitting ? "처리 중..." : isEditMode ? "회원 수정" : "회원 등록"}
            </button>
            {isEditMode ? (
              <button className="ghost-btn" type="button" onClick={() => void cancelEditMember()} disabled={memberSubmitting}>
                수정 취소
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="table-toolbar">
          <h2>회원 목록</h2>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void refreshAll(logPage, true)}
            disabled={loading}
          >
            목록 다시 불러오기
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>역할</th>
                <th>상태</th>
                <th>계정 유형</th>
                <th>CU12 ID</th>
                <th>메일</th>
                <th>등록일</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={8}>등록된 회원이 없습니다.</td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td>
                      <span className={`status-chip ${statusChipClassForMember(member.isActive)}`}>
                        {member.isActive ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td>{member.isTestUser ? "테스트 계정" : "CU12 계정"}</td>
                    <td>{member.cu12Account?.cu12Id ?? "-"}</td>
                    <td>{member.mailPreference?.email ?? "-"}</td>
                    <td>{formatDateTime(member.createdAt)}</td>
                    <td>
                      <div className="action-row">
                        <button type="button" className="ghost-btn" onClick={() => startImpersonation(member)}>
                          대리접속
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => {
                            startEditMember(member);
                          }}
                          disabled={memberSubmitting}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void toggleMemberActive(member)}
                          disabled={memberBusyId === member.id}
                        >
                          {memberBusyId === member.id ? "처리 중..." : member.isActive ? "비활성화" : "활성화"}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void sendTestMail(member)}
                          disabled={mailTestUserId === member.id}
                        >
                          {mailTestUserId === member.id ? "처리 중..." : "메일 테스트"}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => deactivateMember(member)}
                          disabled={memberBusyId === member.id || member.id === context.actor.userId}
                        >
                          {memberBusyId === member.id ? "처리 중..." : "탈퇴"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="table-toolbar">
          <h2>초대 코드 관리</h2>
          <span className="text-small muted">회원 등록 전에 초대 코드를 발급해 초대 기반 등록을 허용할 수 있습니다.</span>
        </div>
        <form className="form-grid top-gap" onSubmit={createInvite}>
          <label className="field">
            <span>CU12 ID</span>
            <input
              value={inviteCu12Id}
              onChange={(event) => setInviteCu12Id(event.target.value)}
              minLength={4}
              required
            />
          </label>
          <label className="field">
            <span>역할</span>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as RoleType)}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label className="field">
            <span>유효시간 (시간)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={inviteExpiresHours}
              onChange={(event) => setInviteExpiresHours(Math.max(1, Number(event.target.value) || 1))}
              required
            />
          </label>
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={inviteSubmitting}>
              {inviteSubmitting ? "처리 중..." : "초대 코드 생성"}
            </button>
          </div>
        </form>

        {latestToken ? (
          <div className="invite-token">
            <div>
              <span className="text-small muted">최근 생성 코드</span>
              <code>{latestToken}</code>
            </div>
            <button className="ghost-btn" type="button" onClick={() => void copyInviteToken()}>
              클립보드 복사
            </button>
          </div>
        ) : null}

        <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>
                <th>CU12 ID</th>
                <th>역할</th>
                <th>상태</th>
                <th>생성일</th>
                <th>만료일</th>
                <th>사용일</th>
                <th>사용자</th>
                <th>조작</th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr>
                  <td colSpan={8}>발급된 초대 코드가 없습니다.</td>
                </tr>
              ) : (
                invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.cu12Id}</td>
                    <td>{invite.role}</td>
                    <td>
                      <span className={`status-chip ${statusChipClassForInvite(invite.state)}`}>
                        {invite.state}
                      </span>
                    </td>
                    <td>{formatDateTime(invite.createdAt)}</td>
                    <td>{formatDateTime(invite.expiresAt)}</td>
                    <td>{formatDateTime(invite.usedAt)}</td>
                    <td>{invite.usedByEmail ?? "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => void toggleInvite(invite)}
                        disabled={inviteBusyId === invite.id}
                      >
                        {inviteBusyId === invite.id ? "처리 중..." : invite.isActive ? "비활성화" : "활성화"}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => void deleteInvite(invite)}
                        disabled={inviteBusyId === invite.id}
                      >
                        {inviteBusyId === invite.id ? "처리 중..." : "삭제"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>운영 로그</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>발생 시각</th>
                <th>구분</th>
                <th>심각도</th>
                <th>행위자</th>
                <th>대상자</th>
                <th>메시지</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6}>운영 로그가 없습니다.</td>
                </tr>
              ) : logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
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

        {logPagination && logPagination.totalPages > 1 ? (
          <div className="pagination">
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goToLogPage((logPagination.page ?? 1) - 1)}
              disabled={!logPagination.hasPrevPage || logBusy}
            >
              이전
            </button>
            {logPageButtons.map((page) => (
              <button
                type="button"
                key={page}
                className={`pagination-button ghost-btn${(logPagination.page ?? 1) === page ? " active" : ""}`}
                onClick={() => goToLogPage(page)}
                disabled={logBusy}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goToLogPage((logPagination.page ?? 1) + 1)}
              disabled={!logPagination.hasNextPage || logBusy}
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      {blockingMessage ? (
        <div className="modal-overlay">
          <section className="modal-card processing-card">
            <h2>처리 중</h2>
            <p className="muted">{blockingMessage}</p>
            <div className="loading-bar">
              <span />
            </div>
          </section>
        </div>
      ) : null}

      {activeNotification ? (
        <div className="modal-overlay" onClick={() => setActiveNotification(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>최근 로그 알림</h2>
            <p className="muted">
              {toDateTime(activeNotification.occurredAt ?? activeNotification.createdAt)} · {activeNotification.courseTitle}
            </p>
            <p>{activeNotification.message}</p>
            <button type="button" className="ghost-btn" onClick={() => setActiveNotification(null)}>
              닫기
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
