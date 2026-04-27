"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readJsonBody, resolveClientResponseError } from "../../src/lib/client-response";
import { AppTopbar } from "../../components/layout/app-topbar";

type RoleType = "ADMIN" | "USER";
type CampusType = "SONGSIM" | "SONGSIN";
type PortalProvider = "CU12" | "CYBER_CAMPUS";
type UserApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

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
  provider: PortalProvider;
  cu12Id: string;
  campus: CampusType | null;
  accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR";
  statusReason: string | null;
  quizAutoSolveEnabled?: boolean;
}

interface Member {
  id: string;
  email: string;
  role: RoleType;
  name: string | null;
  isActive: boolean;
  isTestUser: boolean;
  approvalStatus: UserApprovalStatus;
  approvalRequestedAt: string | null;
  approvalDecidedAt: string | null;
  approvalDecidedByUserId: string | null;
  approvalRejectedReason: string | null;
  createdAt: string;
  cu12Account: Cu12Account | null;
  mailPreference: MailPreference | null;
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

interface LogFilters {
  category: string;
  severity: string;
  targetUserId: string;
  actorUserId: string;
  from: string;
  to: string;
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

interface LogsPayload {
  logs: AdminLog[];
  pagination: LogPagination;
}

interface LogPurgeResponse {
  deleted: number;
  retained: number;
  retainedLogId: string;
}

interface MemberCreateResponse {
  created: boolean;
}

interface MemberUpdateResponse {
  updated: boolean;
  user: Member;
}

interface MemberApprovalResponse {
  updated: boolean;
  user: Member;
}

interface MemberSyncResponse {
  jobId: string;
  status: string;
  deduplicated: boolean;
  dispatched: boolean;
  dispatchError: string | null;
  notice: string;
}

const LOGS_PAGE_SIZE = 25;
const INITIAL_LOG_FILTERS: LogFilters = {
  category: "",
  severity: "",
  targetUserId: "",
  actorUserId: "",
  from: "",
  to: "",
};

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

function formatFilterDate(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toDateTime(value: string | null): string {
  return formatDateTime(value);
}

function statusChipClassForMember(isActive: boolean) {
  return isActive ? "status-active" : "status-failed";
}

function approvalStatusLabel(status: UserApprovalStatus) {
  if (status === "PENDING") return "승인 대기";
  if (status === "REJECTED") return "승인 거절";
  return "승인 완료";
}

function statusChipClassForApproval(status: UserApprovalStatus) {
  if (status === "PENDING") return "status-used";
  if (status === "REJECTED") return "status-failed";
  return "status-active";
}

export function AdminClient({ initialUser }: AdminClientProps) {
  const router = useRouter();

  const [context, setContext] = useState<SessionContext>({
    actor: { userId: "-", email: initialUser.email, role: initialUser.role },
    effective: { userId: "-", email: initialUser.email, role: initialUser.role },
    impersonating: false,
  });

  const [members, setMembers] = useState<Member[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [logPagination, setLogPagination] = useState<LogPagination | null>(null);

  const [loading, setLoading] = useState(true);
  const [blockingMessage, setBlockingMessage] = useState<string | null>("처리 중");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [memberSyncBusyId, setMemberSyncBusyId] = useState<string | null>(null);
  const [mailTestUserId, setMailTestUserId] = useState<string | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logPurgeBusy, setLogPurgeBusy] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logFilters, setLogFilters] = useState<LogFilters>(INITIAL_LOG_FILTERS);
  const [logFilterDraft, setLogFilterDraft] = useState<LogFilters>(INITIAL_LOG_FILTERS);

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
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }

    let payload: (T & ApiErrorPayload) | null = null;
    try {
      payload = await readJsonBody<T & ApiErrorPayload>(response);
    } catch {
      throw new Error("Server returned an invalid response.");
    }
    if (!response.ok) {
      throw new Error(parseError(payload ?? { error: resolveClientResponseError(response, payload, "Request failed.") }));
    }
    if (!payload) {
      throw new Error("Server returned an empty response.");
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

  const refreshAll = useCallback(async (page = 1, silent = false, filters: LogFilters = logFilters) => {
    const safePage = Math.max(1, Math.floor(page));
    if (!silent) {
      setLoading(true);
      setBlockingMessage("관리자 데이터 조회 중...");
    }
    setError(null);

    const query = new URLSearchParams({
      page: String(safePage),
      limit: String(LOGS_PAGE_SIZE),
    });
    if (filters.category) query.set("category", filters.category);
    if (filters.severity) query.set("severity", filters.severity);
    if (filters.targetUserId) query.set("targetQuery", filters.targetUserId);
    if (filters.actorUserId) query.set("actorQuery", filters.actorUserId);
    const from = formatFilterDate(filters.from);
    if (from) query.set("from", from);
    const to = formatFilterDate(filters.to);
    if (to) query.set("to", to);

    try {
      const [contextPayload, membersPayload, logsPayload] = await Promise.all([
        fetchJson<SessionContext>("/api/session/context"),
        fetchJson<MembersPayload>("/api/admin/members"),
        fetchJson<LogsPayload>(`/api/admin/logs?${query.toString()}`),
      ]);

      setContext(contextPayload);
      setMembers(Array.isArray(membersPayload.members) ? membersPayload.members : []);
      setLogs(Array.isArray(logsPayload.logs) ? logsPayload.logs : []);
      setLogPagination(logsPayload.pagination ?? null);
      setLogPage(logsPayload.pagination?.page ?? safePage);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "관리자 데이터를 불러오지 못했습니다.";
      if (messageText !== "Unauthorized") {
        setError(messageText);
        setMembers([]);
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
  }, [fetchJson, logFilters]);

  useEffect(() => {
    void refreshAll(1, false);
  }, [refreshAll]);

  useEffect(() => {
    if (!message) return;
    toast.success(message, {
      duration: 2800,
      closeButton: true,
    });
    setMessage(null);
  }, [message]);

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
            localPassword: newIsTestUser ? newLocalPassword.trim() : undefined,
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

  const syncMember = useCallback((member: Member) => {
    if (!member.cu12Account?.cu12Id || memberSyncBusyId === member.id) {
      if (!member.cu12Account?.cu12Id) {
        setError("통합 포털 계정이 연결되지 않은 사용자는 동기화할 수 없습니다.");
      }
      return;
    }

    setMemberSyncBusyId(member.id);
    void withBlocking(`${member.email} 동기화 요청 중...`, async () => {
      const response = await fetchJson<MemberSyncResponse>(`/api/admin/members/${member.id}/sync`, { method: "POST" });
      setMessage(response.notice ?? "동기화 요청이 완료되었습니다.");
      await refreshAll(logPage, true);
    }).finally(() => {
      setMemberSyncBusyId(null);
    });
  }, [fetchJson, logPage, refreshAll, withBlocking, memberSyncBusyId]);

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

  const decideMemberApproval = useCallback((member: Member, action: "APPROVE" | "REJECT", role?: RoleType) => {
    if (approvalBusyId) return;
    if (action === "REJECT" && !window.confirm(member.email + " 승인 요청을 거절할까요?")) return;

    setApprovalBusyId(member.id);
    void withBlocking(action === "APPROVE" ? "회원 승인 처리 중..." : "회원 승인 거절 처리 중...", async () => {
      const reason = action === "REJECT" ? "관리자 승인 거절" : undefined;
      await fetchJson<MemberApprovalResponse>("/api/admin/members/" + member.id + "/approval", {
        method: "POST",
        body: JSON.stringify({ action, role, reason }),
      });
      setMessage(action === "APPROVE" ? member.email + " 계정을 승인했습니다." : member.email + " 승인 요청을 거절했습니다.");
      await refreshAll(logPage, true);
    }).finally(() => {
      setApprovalBusyId(null);
    });
  }, [approvalBusyId, fetchJson, logPage, refreshAll, withBlocking]);

  const goToLogPage = useCallback((page: number) => {
    if (!logPagination || loading || logBusy) return;
    const safePage = Math.max(1, Math.min(page, logPagination.totalPages || 1));
    setLogPage(safePage);
    setLogBusy(true);
    void refreshAll(safePage, true);
  }, [logPagination, loading, logBusy, refreshAll]);

  const applyLogFilters = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLogFilters(logFilterDraft);
    void refreshAll(1, false, logFilterDraft);
  }, [logFilterDraft, refreshAll]);

  const resetLogFilters = useCallback(() => {
    setLogFilterDraft(INITIAL_LOG_FILTERS);
    setLogFilters(INITIAL_LOG_FILTERS);
    void refreshAll(1, false, INITIAL_LOG_FILTERS);
  }, [refreshAll]);

  const purgeLogs = useCallback(() => {
    if (logPurgeBusy || loading || !!blockingMessage) return;
    if (!window.confirm("운영 로그를 전체 삭제할까요? 삭제 후 감사 로그 1건은 유지됩니다.")) return;

    setLogPurgeBusy(true);
    void withBlocking("운영 로그 전체 정리 중...", async () => {
      const payload = await fetchJson<LogPurgeResponse>("/api/admin/logs", { method: "DELETE" });
      setLogFilterDraft(INITIAL_LOG_FILTERS);
      setLogFilters(INITIAL_LOG_FILTERS);
      await refreshAll(1, true, INITIAL_LOG_FILTERS);
      setMessage(`운영 로그 ${payload.deleted}건 삭제 완료 (감사 로그 ${payload.retained}건 유지).`);
    }).finally(() => {
      setLogPurgeBusy(false);
    });
  }, [blockingMessage, fetchJson, loading, logPurgeBusy, refreshAll, withBlocking]);

  const updateLogFilterDraft = useCallback((key: keyof LogFilters, value: string) => {
    setLogFilterDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

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
  const pendingMembers = useMemo(() => members.filter((member) => member.approvalStatus === "PENDING"), [members]);
  const rejectedMemberCount = useMemo(() => members.filter((member) => member.approvalStatus === "REJECTED").length, [members]);

  return (
    <main className="dashboard-main page-shell">
      <AppTopbar
        mode="admin"
        title="운영 관리센터"
        navLinks={[
          { href: "/admin/site-notices", label: "공지/점검 설정" },
          { href: "/admin/operations", label: "운영 메뉴" },
          { href: "/admin/system", label: "시스템 상태" },
          { href: "/admin/system/policies", label: "약관/고지" },
        ]}
        email={context.effective.email}
        role={initialUser.role}
        impersonating={context.impersonating}
        refreshing={loading || !!blockingMessage}
        onRefresh={() => void refreshAll(logPage, false)}
        onDashboard={() => goDashboard()}
        onLogout={logout}
      />
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">가톨릭대학교 수강 지원 솔루션 관리자</p>
          <h1>운영 관리센터</h1>
          <p className="text-small muted">
            회원 {members.length}명, 승인 대기 {pendingMembers.length}명, 로그 {logPagination?.total ?? 0}건
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
          <h2>승인 대기</h2>
          <p className="metric">{pendingMembers.length}명</p>
          <p className="muted">거절 {rejectedMemberCount}명</p>
        </article>
        <article className="admin-stat card">
          <h2>로그 페이지</h2>
          <p className="metric">{logPagination?.totalPages ?? 0}</p>
          <p className="muted">페이지 단위</p>
        </article>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="card">
        <div className="table-toolbar">
          <h2>{isEditMode ? "회원 정보 수정" : "회원 등록"}</h2>
          <span className="text-small muted">
            {isEditMode ? "목록에서 선택한 회원 정보를 수정합니다." : "신규 사용자 등록 또는 기존 계정 갱신"}
          </span>
        </div>
        <form className="form-grid top-gap" onSubmit={createMember}>
          <label className="field">
            <span>통합 포털 ID</span>
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
            <span>CU12 교정 설정</span>
            <select
              value={newCampus}
              onChange={(event) => setNewCampus(event.target.value as CampusType)}
              disabled={isEditMode}
            >
              <option value="SONGSIM">성심교정</option>
              <option value="SONGSIN">성신교정</option>
            </select>
            {isEditMode ? (
              <p className="muted text-small">CU12 교정 설정은 등록 후 별도 API에서 수정하세요.</p>
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
                <p className="muted">통합 포털 비밀번호는 이 화면에서 수정할 수 없습니다.</p>
              ) : (
                <label className="field">
                  <span>통합 포털 비밀번호</span>
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
        <div className="table-wrap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>역할</th>
                <th>상태</th>
                <th>계정 유형</th>
                <th>승인</th>
                <th>CU12 ID</th>
                <th>메일</th>
                <th>등록일</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={9}>등록된 회원이 없습니다.</td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id}>
                    <td data-label="이메일">{member.email}</td>
                    <td data-label="역할">{member.role}</td>
                    <td data-label="상태">
                      <span className={`status-chip ${statusChipClassForMember(member.isActive)}`}>
                        {member.isActive ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td data-label="계정 유형">{member.isTestUser ? "테스트 계정" : "CU12 계정"}</td>
                    <td data-label="승인">
                      <span className={`status-chip ${statusChipClassForApproval(member.approvalStatus)}`}>
                        {approvalStatusLabel(member.approvalStatus)}
                      </span>
                    </td>
                    <td data-label="CU12 ID">{member.cu12Account?.cu12Id ?? "-"}</td>
                    <td data-label="메일">{member.mailPreference?.email ?? "-"}</td>
                    <td data-label="등록일">{formatDateTime(member.createdAt)}</td>
                    <td data-label="액션">
                      <div className="action-row">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => syncMember(member)}
                          disabled={memberSyncBusyId === member.id || memberBusyId === member.id || !member.cu12Account}
                        >
                          {memberSyncBusyId === member.id ? "동기화 중..." : "동기화"}
                        </button>
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
                          disabled={memberBusyId === member.id || member.approvalStatus !== "APPROVED"}
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
          <h2>승인 대기</h2>
          <span className="text-small muted">최초 로그인 후 관리자 승인을 기다리는 계정입니다.</span>
        </div>
        <div className="table-wrap top-gap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>계정 ID</th>
                <th>요청일</th>
                <th>상태</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {pendingMembers.length === 0 ? (
                <tr>
                  <td colSpan={4}>승인 대기 계정이 없습니다.</td>
                </tr>
              ) : (
                pendingMembers.map((member) => (
                  <tr key={member.id}>
                    <td data-label="계정 ID">{member.email}</td>
                    <td data-label="요청일">{formatDateTime(member.approvalRequestedAt)}</td>
                    <td data-label="상태">
                      <span className={`status-chip ${statusChipClassForApproval(member.approvalStatus)}`}>
                        {approvalStatusLabel(member.approvalStatus)}
                      </span>
                    </td>
                    <td data-label="처리">
                      <div className="action-row">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => decideMemberApproval(member, "APPROVE", "USER")}
                          disabled={approvalBusyId === member.id}
                        >
                          USER 승인
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => decideMemberApproval(member, "APPROVE", "ADMIN")}
                          disabled={approvalBusyId === member.id}
                        >
                          ADMIN 승인
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => decideMemberApproval(member, "REJECT")}
                          disabled={approvalBusyId === member.id}
                        >
                          거절
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
          <h2>운영 로그</h2>
          <button
            type="button"
            className="btn-danger"
            onClick={purgeLogs}
            disabled={logPurgeBusy || loading || !!blockingMessage}
          >
            {logPurgeBusy ? "정리 중..." : "운영 로그 전체 정리"}
          </button>
        </div>
        <form className="form-grid top-gap" onSubmit={applyLogFilters}>
          <label className="field">
            <span>카테고리</span>
            <select
              value={logFilterDraft.category}
              onChange={(event) => updateLogFilterDraft("category", event.target.value)}
            >
              <option value="">전체</option>
              <option value="AUTH">AUTH</option>
              <option value="ADMIN">ADMIN</option>
              <option value="JOB">JOB</option>
              <option value="WORKER">WORKER</option>
              <option value="MAIL">MAIL</option>
              <option value="PARSER">PARSER</option>
              <option value="IMPERSONATION">IMPERSONATION</option>
            </select>
          </label>
          <label className="field">
            <span>심각도</span>
            <select
              value={logFilterDraft.severity}
              onChange={(event) => updateLogFilterDraft("severity", event.target.value)}
            >
              <option value="">전체</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
            </select>
          </label>
          <label className="field">
            <span>행위자 포털 ID / 내부 ID</span>
            <input
              value={logFilterDraft.actorUserId}
              onChange={(event) => updateLogFilterDraft("actorUserId", event.target.value)}
              placeholder="예: 사용자 아이디 또는 사용자 ID"
            />
          </label>
          <label className="field">
            <span>대상 포털 ID / 내부 ID</span>
            <input
              value={logFilterDraft.targetUserId}
              onChange={(event) => updateLogFilterDraft("targetUserId", event.target.value)}
              placeholder="예: 사용자 아이디 또는 사용자 ID"
            />
          </label>
          <label className="field">
            <span>시작 시간</span>
            <input
              type="datetime-local"
              value={logFilterDraft.from}
              onChange={(event) => updateLogFilterDraft("from", event.target.value)}
            />
          </label>
          <label className="field">
            <span>종료 시간</span>
            <input
              type="datetime-local"
              value={logFilterDraft.to}
              onChange={(event) => updateLogFilterDraft("to", event.target.value)}
            />
          </label>
          <div className="align-end">
            <button className="btn-success" type="submit">
              필터 적용
            </button>
            <button className="ghost-btn" type="button" onClick={resetLogFilters}>
              필터 초기화
            </button>
          </div>
        </form>

        <div className="table-wrap mobile-card-table">
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
                  <td data-label="발생 시각">{formatDateTime(log.createdAt)}</td>
                  <td data-label="구분">{log.category}</td>
                  <td data-label="심각도">{log.severity}</td>
                  <td data-label="행위자">{log.actor?.email ?? "-"}</td>
                  <td data-label="대상자">{log.target?.email ?? "-"}</td>
                  <td data-label="메시지">{log.message}</td>
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


    </main>
  );
}
