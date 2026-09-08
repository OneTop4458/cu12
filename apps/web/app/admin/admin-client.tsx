"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readJsonBody, resolveClientResponseError } from "../../src/lib/client-response";
import { formatAdminMemberLastLogin } from "../../src/lib/admin-member-last-login";
import { AppTopbar } from "../../components/layout/app-topbar";
import { Switch } from "../../components/ui/switch";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";

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
  alertOnNotice: boolean;
  alertOnDeadline: boolean;
  alertOnAutolearn: boolean;
  digestEnabled: boolean;
  digestHour: number;
  updatedAt: string;
}

interface Cu12Account {
  provider: PortalProvider;
  cu12Id: string;
  campus: CampusType | null;
  accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR";
  statusReason: string | null;
  autoLearnEnabled: boolean;
  quizAutoSolveEnabled: boolean;
  detectActivitiesEnabled: boolean;
  emailDigestEnabled: boolean;
  updatedAt: string;
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
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
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

interface AdminSettings {
  memberApprovalRequired: boolean;
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
  const [memberQuery, setMemberQuery] = useState("");
  const [memberFilter, setMemberFilter] = useState("ALL");
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const memberFormTriggerRef = useRef<HTMLElement | null>(null);
  const detailMember = members.find((member) => member.id === detailMemberId) ?? null;
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
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
  const [newCampus, setNewCampus] = useState<CampusType | "">("SONGSIM");
  const [newRole, setNewRole] = useState<RoleType>("USER");
  const [newIsTestUser, setNewIsTestUser] = useState(false);
  const [newIsActive, setNewIsActive] = useState(true);
  const [newCu12Password, setNewCu12Password] = useState("");
  const [newLocalPassword, setNewLocalPassword] = useState("");
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [automationDraft, setAutomationDraft] = useState({ autoLearnEnabled: true, quizAutoSolveEnabled: true, detectActivitiesEnabled: true });
  const [mailDraft, setMailDraft] = useState({ email: "", enabled: true, alertOnDeadline: true, alertOnAutolearn: true });
  const [mailChanged, setMailChanged] = useState(false);
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
        fetchJson<MembersPayload>("/api/admin/members?limit=500"),
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

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    setSettingsBusy(true);
    try {
      setSettings(await fetchJson<AdminSettings>("/api/admin/settings"));
    } catch {
      setSettingsError("승인 대기 설정을 불러오지 못했습니다.");
    } finally {
      setSettingsBusy(false);
    }
  }, [fetchJson]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveApprovalRequired = async (memberApprovalRequired: boolean) => {
    setSettingsBusy(true);
    setSettingsError(null);
    try {
      setSettings(await fetchJson<AdminSettings>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ memberApprovalRequired }),
      }));
      setMessage(`회원 승인 대기를 ${memberApprovalRequired ? "ON" : "OFF"}으로 저장했습니다.`);
    } catch {
      setSettingsError("승인 대기 설정을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSettingsBusy(false);
    }
  };

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
    setMailChanged(false);
    setError(null);
  }, []);

  const startEditMember = useCallback((member: Member, trigger?: HTMLElement | null) => {
    memberFormTriggerRef.current = trigger ?? detailTriggerRef.current;
    setEditingMemberId(member.id);
    setEditingMember(member);
    setNewCu12Id(member.cu12Account?.cu12Id ?? member.email);
    setNewName(member.name ?? "");
    setNewCampus(member.cu12Account?.campus ?? "");
    setNewRole(member.role);
    setNewIsTestUser(member.isTestUser);
    setNewIsActive(member.isActive);
    setNewCu12Password("");
    setNewLocalPassword("");
    setAutomationDraft({
      autoLearnEnabled: member.cu12Account?.autoLearnEnabled ?? true,
      quizAutoSolveEnabled: member.cu12Account?.quizAutoSolveEnabled ?? true,
      detectActivitiesEnabled: member.cu12Account?.detectActivitiesEnabled ?? true,
    });
    setMailDraft({
      email: member.mailPreference?.email ?? "",
      enabled: member.mailPreference?.enabled ?? true,
      alertOnDeadline: member.mailPreference?.alertOnDeadline ?? true,
      alertOnAutolearn: member.mailPreference?.alertOnAutolearn ?? true,
    });
    setMailChanged(false);
    setError(null);
    setDetailMemberId(null);
    setMemberFormOpen(true);
  }, []);

  const cancelEditMember = useCallback(() => {
    setMemberFormOpen(false);
    resetMemberForm();
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
          const patchPayload: Record<string, unknown> = {};
          if (newRole !== editingMember?.role) patchPayload.role = newRole;
          if (newIsTestUser !== editingMember?.isTestUser) patchPayload.isTestUser = newIsTestUser;
          if (newIsActive !== editingMember?.isActive) patchPayload.isActive = newIsActive;
          const nextName = newName.trim() || trimmedCu12Id;
          if (nextName !== editingMember?.name) patchPayload.name = nextName;
          if (editingMember?.cu12Account) {
            for (const key of ["autoLearnEnabled", "quizAutoSolveEnabled", "detectActivitiesEnabled"] as const) {
              if (automationDraft[key] !== editingMember.cu12Account[key]) patchPayload[key] = automationDraft[key];
            }
            if (editingMember.cu12Account.provider === "CU12" && newCampus && newCampus !== editingMember.cu12Account.campus) {
              patchPayload.campus = newCampus;
            }
          }
          if (mailChanged) patchPayload.mailPreference = { ...mailDraft, email: mailDraft.email.trim() };
          if (newIsTestUser && newLocalPassword.trim()) {
            patchPayload.localPassword = newLocalPassword.trim();
          }
          if (Object.keys(patchPayload).length === 0) {
            setMessage("변경된 내용이 없습니다.");
            return { updated: false };
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
            cu12Password: newIsTestUser ? undefined : newCu12Password.trim(),
            localPassword: newIsTestUser ? newLocalPassword.trim() : undefined,
            name: newName.trim() || undefined,
            campus: newCampus || "SONGSIM",
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
      setMemberFormOpen(false);
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
    editingMember,
    automationDraft,
    mailDraft,
    mailChanged,
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
      const response = await fetchJson<MemberSyncResponse>(`/api/admin/members/${member.id}/sync`, {
        method: "POST",
        body: JSON.stringify({}),
      });
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
  const visibleMembers = useMemo(() => members.filter((member) => {
    const query = memberQuery.trim().toLowerCase();
    const text = [member.email, member.name, member.cu12Account?.cu12Id, member.mailPreference?.email].join(" ").toLowerCase();
    return (!query || text.includes(query))
      && (memberFilter === "ALL" || (memberFilter === "ACTIVE" ? member.isActive : member.approvalStatus === memberFilter));
  }), [members, memberQuery, memberFilter]);

  return (
    <main className="dashboard-main page-shell">
      <AppTopbar
        title="회원 관리"
        email={context.effective.email}
        role={initialUser.role}
        impersonating={context.impersonating}
        showAdminNav
        onDashboard={() => goDashboard()}
        onLogout={logout}
      />
      <section className="card admin-hero">
        <div>
          <p className="brand-kicker">가톨릭대학교 수강 지원 솔루션 관리자</p>
          <h1>회원 관리</h1>
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
          <h2 id="member-approval-label">회원 승인 대기</h2>
          <div className="action-row">
            <span>{settings ? (settings.memberApprovalRequired ? "ON" : "OFF") : "설정 확인 중"}</span>
            <Switch
              aria-labelledby="member-approval-label"
              aria-describedby="member-approval-description"
              checked={settings?.memberApprovalRequired ?? true}
              disabled={!settings || settingsBusy}
              onCheckedChange={(checked) => void saveApprovalRequired(checked)}
            />
            {settingsBusy ? <span role="status">처리 중...</span> : null}
          </div>
        </div>
        <p id="member-approval-description" className="text-small muted top-gap">
          기본값은 ON입니다. OFF 동안에는 포털 인증에 성공한 신규·승인 대기 회원이 로그인 시 자동 승인됩니다. 약관 동의는 계속 필요합니다.
        </p>
        {settingsError ? (
          <div className="action-row top-gap">
            <p className="error-text" role="alert">{settingsError}</p>
            <button type="button" className="ghost-btn" disabled={settingsBusy} onClick={() => void loadSettings()}>설정 다시 불러오기</button>
          </div>
        ) : null}
      </section>

      <Dialog open={memberFormOpen} onOpenChange={(open) => { if (!open && !memberSubmitting) cancelEditMember(); }}>
        <DialogContent className="admin-member-detail" showCloseButton={false} onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (memberFormTriggerRef.current?.isConnected) memberFormTriggerRef.current.focus();
        }}>
          <DialogHeader>
            <div className="table-toolbar">
              <DialogTitle>{isEditMode ? "회원 정보 수정" : "회원 등록"}</DialogTitle>
              <button type="button" className="ghost-btn" disabled={memberSubmitting} onClick={cancelEditMember}>닫기</button>
            </div>
            <DialogDescription>
              {isEditMode ? `${editingMember?.email} · 기본 정보와 자동화·메일 수신 설정을 수정합니다.` : "포털 인증을 거쳐 신규 회원을 등록합니다."}
            </DialogDescription>
          </DialogHeader>
        <form className="admin-member-detail-body" onSubmit={createMember}>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <fieldset className="form-grid top-gap admin-form-fields" disabled={memberSubmitting}>
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
              placeholder="비우면 포털 ID로 표시"
            />
          </label>
          <label className="field">
            <span>CU12 교정 설정</span>
            <select
              value={newCampus}
              onChange={(event) => setNewCampus(event.target.value as CampusType)}
              disabled={isEditMode && editingMember?.cu12Account?.provider !== "CU12"}
            >
              <option value="" disabled>교정 선택</option>
              <option value="SONGSIM">성심교정</option>
              <option value="SONGSIN">성신교정</option>
            </select>
          </label>
          <label className="field">
            <span>역할</span>
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as RoleType)} disabled={editingMemberId === context.actor.userId}>
              <option value="USER">일반 회원</option>
              <option value="ADMIN">관리자</option>
            </select>
          </label>
          <label className="field">
            <span>회원 구분</span>
            <select
              value={newIsTestUser ? "true" : "false"}
              onChange={(event) => setNewIsTestUser(event.target.value === "true")}
              disabled={editingMemberId === context.actor.userId}
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
              disabled={isEditMode && (editingMember?.approvalStatus !== "APPROVED" || editingMemberId === context.actor.userId)}
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
                required={!isEditMode || !originalEditModeIsTestUser}
                placeholder={isEditMode && originalEditModeIsTestUser ? "비우면 기존 비밀번호 유지" : undefined}
              />
            </label>
          ) : (
            <>
              {isEditMode ? (
                <p className="muted text-small">포털 비밀번호는 회원이 다시 로그인하면 갱신됩니다.</p>
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
          {isEditMode ? (
            <>
              <fieldset className="admin-form-wide admin-setting-fields" disabled={!editingMember?.cu12Account}>
                <legend>자동화 설정</legend>
                {!editingMember?.cu12Account ? <p className="muted text-small">연결된 포털 계정이 없습니다.</p> : null}
                {([
                  ["autoLearnEnabled", "자동 수강"],
                  ["quizAutoSolveEnabled", "퀴즈 자동 풀이"],
                  ["detectActivitiesEnabled", "활동 감지"],
                ] as const).map(([key, label]) => (
                  <label className="admin-setting-row" key={key}>
                    <span>{label}</span>
                    <Switch checked={automationDraft[key]} onCheckedChange={(checked) => setAutomationDraft((draft) => ({ ...draft, [key]: checked }))} />
                  </label>
                ))}
              </fieldset>
              <fieldset className="admin-form-wide admin-setting-fields">
                <legend>메일 수신 설정</legend>
                <label className="field">
                  <span>수신 이메일</span>
                  <input
                    type="email"
                    maxLength={200}
                    value={mailDraft.email}
                    required={mailChanged}
                    placeholder="메일 수신 주소"
                    onChange={(event) => {
                      setMailDraft((draft) => ({ ...draft, email: event.target.value }));
                      setMailChanged(true);
                    }}
                  />
                </label>
                {([
                  ["enabled", "메일 수신"],
                  ["alertOnDeadline", "마감 알림"],
                  ["alertOnAutolearn", "자동 수강 결과 알림"],
                ] as const).map(([key, label]) => (
                  <label className="admin-setting-row" key={key}>
                    <span>{label}</span>
                    <Switch checked={mailDraft[key]} onCheckedChange={(checked) => {
                      setMailDraft((draft) => ({ ...draft, [key]: checked }));
                      setMailChanged(true);
                    }} />
                  </label>
                ))}
                <p className="muted text-small">약관 변경 안내는 이 수신 설정과 별도로 발송되며, 승인 요청은 수신을 켠 관리자에게 발송됩니다. 정기 요약·일반 공지 메일은 발송하지 않습니다.</p>
              </fieldset>
            </>
          ) : null}
          <div className="action-row admin-form-wide">
            <button className="btn-success" type="submit" disabled={memberSubmitting}>
              {memberSubmitting ? "처리 중..." : isEditMode ? "변경사항 저장" : "회원 등록"}
            </button>
            {isEditMode ? (
              <button className="ghost-btn" type="button" onClick={() => void cancelEditMember()} disabled={memberSubmitting}>
                수정 취소
              </button>
            ) : null}
          </div>
          </fieldset>
        </form>
        </DialogContent>
      </Dialog>

      <section className="card">
        <div className="table-toolbar">
          <h2>회원 목록</h2>
          <div className="action-row">
          <button type="button" onClick={(event) => { memberFormTriggerRef.current = event.currentTarget; resetMemberForm(); setMemberFormOpen(true); }} disabled={loading}>
            회원 등록
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void refreshAll(logPage, true)}
            disabled={loading}
          >
            목록 다시 불러오기
          </button>
          </div>
        </div>
        <div className="admin-member-filters top-gap">
          <label className="field">
            <span>회원 검색</span>
            <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="이름·포털 ID·수신 이메일" type="search" />
          </label>
          <label className="field">
            <span>회원 상태 필터</span>
            <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}>
              <option value="ALL">전체</option>
              <option value="ACTIVE">활성 회원</option>
              <option value="PENDING">승인 대기</option>
              <option value="REJECTED">승인 거절</option>
            </select>
          </label>
        </div>
        <p className="text-small muted top-gap" role="status">조회한 {members.length}명 중 {visibleMembers.length}명 표시 · 최근 회원 최대 500명</p>
        <div className="table-wrap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>회원</th>
                <th>역할</th>
                <th>상태</th>
                <th>계정 유형</th>
                <th>승인</th>
                <th>메일</th>
                <th>등록일</th>
                <th>마지막 로그인 (KST)</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.length === 0 ? (
                <tr>
                  <td colSpan={9}>{members.length === 0 ? "등록된 회원이 없습니다." : "검색 조건에 맞는 회원이 없습니다."}</td>
                </tr>
              ) : (
                visibleMembers.map((member) => (
                  <tr key={member.id}>
                    <td data-label="회원">
                      <strong>{member.name || member.email}</strong>
                      {member.name && member.name !== member.email ? <p className="text-small muted">{member.email}</p> : null}
                    </td>
                    <td data-label="역할">{member.role === "ADMIN" ? "관리자" : "일반 회원"}</td>
                    <td data-label="상태">
                      <span className={`status-chip ${statusChipClassForMember(member.isActive)}`}>
                        {member.isActive ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td data-label="계정 유형">{member.isTestUser ? "테스트 계정" : !member.cu12Account ? "포털 미연결" : member.cu12Account.provider === "CU12" ? "CU12 공유대학" : "사이버캠퍼스"}</td>
                    <td data-label="승인">
                      <span className={`status-chip ${statusChipClassForApproval(member.approvalStatus)}`}>
                        {approvalStatusLabel(member.approvalStatus)}
                      </span>
                    </td>
                    <td data-label="메일">{member.mailPreference?.email ?? "-"}</td>
                    <td data-label="등록일">{formatDateTime(member.createdAt)}</td>
                    <td data-label="마지막 로그인 (KST)">{formatAdminMemberLastLogin(member.lastLoginAt)}</td>
                    <td data-label="액션">
                      <div className="action-row">
                        <button type="button" className="ghost-btn" onClick={(event) => { detailTriggerRef.current = event.currentTarget; setDetailMemberId(member.id); }}>
                          상세
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={(event) => {
                            startEditMember(member, event.currentTarget);
                          }}
                          disabled={memberSubmitting}
                        >
                          수정
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="ghost-btn" aria-label={`${member.email} 더보기`}>
                              더보기
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="admin-member-actions" align="end">
                            <DropdownMenuItem onSelect={() => syncMember(member)} disabled={memberSyncBusyId === member.id || memberBusyId === member.id || !member.cu12Account || !member.isActive || member.isTestUser}>
                              동기화
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => startImpersonation(member)} disabled={!member.isActive || member.approvalStatus !== "APPROVED"}>
                              대리접속
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void sendTestMail(member)} disabled={mailTestUserId === member.id || !member.isActive}>
                              메일 테스트
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => void toggleMemberActive(member)} disabled={memberBusyId === member.id || member.approvalStatus !== "APPROVED" || member.id === context.actor.userId}>
                              {member.isActive ? "비활성화" : "활성화"}
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => deactivateMember(member)} disabled={memberBusyId === member.id || member.id === context.actor.userId}>
                              회원 탈퇴
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={detailMember !== null} onOpenChange={(open) => { if (!open) setDetailMemberId(null); }}>
        <DialogContent className="admin-member-detail" showCloseButton={false} onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!memberFormOpen && detailTriggerRef.current?.isConnected) detailTriggerRef.current.focus();
        }}>
          <DialogHeader>
            <div className="table-toolbar">
              <DialogTitle>회원 상세</DialogTitle>
              {detailMember ? <button type="button" onClick={() => startEditMember(detailMember)}>회원 정보 수정</button> : null}
              <DialogClose asChild><button type="button" className="ghost-btn">닫기</button></DialogClose>
            </div>
            <DialogDescription>{detailMember?.email} · 저장된 상태와 설정</DialogDescription>
          </DialogHeader>
          {detailMember ? (
            <div className="admin-member-detail-body">
              <h3>회원 상태</h3>
              <dl className="admin-member-fields">
                {[
                  ["이름", detailMember.name ?? "-"],
                  ["역할", detailMember.role === "ADMIN" ? "관리자" : "일반 회원"],
                  ["계정 상태", detailMember.isActive ? "활성" : "비활성"],
                  ["회원 구분", detailMember.isTestUser ? "테스트 계정" : "실서비스 계정"],
                  ["승인 상태", approvalStatusLabel(detailMember.approvalStatus)],
                  ["승인 요청일", formatDateTime(detailMember.approvalRequestedAt)],
                  ["승인 결정일", formatDateTime(detailMember.approvalDecidedAt)],
                  ["거절 사유", detailMember.approvalRejectedReason ?? "-"],
                  ["등록일", formatDateTime(detailMember.createdAt)],
                  ["마지막 로그인 (KST)", formatAdminMemberLastLogin(detailMember.lastLoginAt)],
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              <h3>포털 연결 및 자동화 설정</h3>
              {detailMember.cu12Account ? (
                <dl className="admin-member-fields">
                  {[
                    ["포털", detailMember.cu12Account.provider === "CU12" ? "CU12 공유대학" : "사이버캠퍼스"],
                    ["포털 ID", detailMember.cu12Account.cu12Id],
                    ["CU12 교정", detailMember.cu12Account.campus === "SONGSIM" ? "성심교정" : detailMember.cu12Account.campus === "SONGSIN" ? "성신교정" : "-"],
                    ["연결 상태", { CONNECTED: "연결됨", NEEDS_REAUTH: "재인증 필요", ERROR: "오류" }[detailMember.cu12Account.accountStatus]],
                    ["상태 사유", detailMember.cu12Account.statusReason ?? "-"],
                    ["자동 수강", detailMember.cu12Account.autoLearnEnabled ? "ON" : "OFF"],
                    ["퀴즈 자동 풀이", detailMember.cu12Account.quizAutoSolveEnabled ? "ON" : "OFF"],
                    ["활동 감지", detailMember.cu12Account.detectActivitiesEnabled ? "ON" : "OFF"],
                    ["설정 수정일", formatDateTime(detailMember.cu12Account.updatedAt)],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              ) : <p className="muted">연결된 포털 계정이 없습니다.</p>}
              <h3>메일 수신 설정</h3>
              {detailMember.mailPreference ? (
                <dl className="admin-member-fields">
                  {[
                    ["수신 이메일", detailMember.mailPreference.email],
                    ["메일 수신", detailMember.mailPreference.enabled ? "ON" : "OFF"],
                    ["마감 알림", detailMember.mailPreference.alertOnDeadline ? "ON" : "OFF"],
                    ["자동 수강 결과 알림", detailMember.mailPreference.alertOnAutolearn ? "ON" : "OFF"],
                    ["설정 수정일", formatDateTime(detailMember.mailPreference.updatedAt)],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
              ) : <p className="muted">저장된 메일 수신 설정이 없습니다.</p>}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
