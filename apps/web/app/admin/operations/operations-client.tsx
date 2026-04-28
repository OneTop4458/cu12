"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { readJsonBody, resolveClientResponseError } from "../../../src/lib/client-response";
import { AppTopbar } from "../../../components/layout/app-topbar";

type RoleType = "ADMIN" | "USER";
type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
type JobType = "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
type CleanupStatus = "SUCCEEDED" | "FAILED" | "CANCELED";
type CleanupScope = "safe" | "full";

interface AdminOperationsClientProps {
  initialUser: {
    email: string;
    role: RoleType;
  };
  view?: "overview" | "jobs" | "workers" | "reconcile" | "cleanup";
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

interface AdminJob {
  id: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  runAfter: string;
  workerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  result: unknown;
  payload: unknown;
  user: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}

interface AdminJobsPayload {
  jobs: AdminJob[];
  pagination: Pagination;
}

interface WorkerHeartbeat {
  workerId: string;
  lastSeenAt: string;
}

interface WorkersPayload {
  workers: WorkerHeartbeat[];
  summary: {
    total: number;
    active: number;
    stale: number;
    staleMinutes: number;
    capturedAt: string;
    staleCutoff: string;
  };
}

interface CleanupPayload {
  deleted: number;
  deletedByStatus: Record<JobStatus, number>;
  olderThanDays: number;
  statusFilter: JobStatus[];
  scope: CleanupScope;
  dryRun: boolean;
  cutoff: string;
}

interface WorkerPurgePayload {
  deleted: number;
  clearedAt: string;
}

interface ApiErrorPayload {
  error?: string;
  errorCode?: string;
}

interface ReconcileRun {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface ReconcileJob {
  id: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  workerId: string | null;
  runId: number | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReconcileScheduleCheck {
  key: "sync" | "autolearn";
  workflowPath: string;
  expectedCrons: string[];
  actualCrons: string[];
  status: "MATCH" | "MISMATCH" | "UNKNOWN";
  message: string;
}

interface JobReconcilePayload {
  checkedAt: string;
  canReconcileWithGitHub: boolean;
  summary: {
    runningJobsCount: number;
    orphanedRunningJobsCount: number;
    activeRunsCount: number;
    ghostRunsCount: number;
    nonparseableWorkerIdCount: number;
  };
  runningJobs: ReconcileJob[];
  orphanedRunningJobs: ReconcileJob[];
  activeRuns: ReconcileRun[];
  ghostRuns: ReconcileRun[];
  scheduleChecks?: ReconcileScheduleCheck[];
  error?: string;
}

const JOB_STATUS_OPTIONS: Array<JobStatus | ""> = ["", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];
const JOB_TYPE_OPTIONS: Array<JobType | ""> = ["", "SYNC", "AUTOLEARN", "NOTICE_SCAN", "MAIL_DIGEST"];
const CLEANUP_SCOPE_OPTIONS: CleanupScope[] = ["safe", "full"];
const CLEANUP_STATUSES_SAFE: CleanupStatus[] = ["SUCCEEDED", "FAILED", "CANCELED"];
const CLEANUP_STATUSES_FULL: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];
const CLEANUP_SCOPE_LABELS: Record<CleanupScope, string> = {
  safe: "완료/실패/취소만",
  full: "PENDING/RUNNING 포함 전체",
};
const CLEANUP_CONFIRM_CODE = "RESET_ALL_JOBS";

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: "대기",
  RUNNING: "실행중",
  SUCCEEDED: "성공",
  FAILED: "실패",
  CANCELED: "취소",
};

const EMPTY_COUNTS: Record<JobStatus, number> = {
  PENDING: 0,
  RUNNING: 0,
  SUCCEEDED: 0,
  FAILED: 0,
  CANCELED: 0,
};

function parseError(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const maybeError = (payload as ApiErrorPayload).error;
    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError.trim();
    }
  }
  return "요청 처리 중 오류가 발생했습니다.";
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function statusClassForJob(status: JobStatus): string {
  switch (status) {
    case "PENDING":
      return "status-pending";
    case "RUNNING":
      return "status-running";
    case "SUCCEEDED":
      return "status-succeeded";
    case "FAILED":
    case "CANCELED":
      return "status-failed";
    default:
      return "status-failed";
  }
}

function statusClassForSchedule(status: ReconcileScheduleCheck["status"]): string {
  switch (status) {
    case "MATCH":
      return "status-succeeded";
    case "MISMATCH":
      return "status-failed";
    default:
      return "status-pending";
  }
}

export function AdminOperationsClient({ initialUser, view = "overview" }: AdminOperationsClientProps) {
  const router = useRouter();

  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [workers, setWorkers] = useState<WorkerHeartbeat[]>([]);
  const [workerSummary, setWorkerSummary] = useState<WorkersPayload["summary"] | null>(null);
  const [jobCounts, setJobCounts] = useState<Record<JobStatus, number>>(EMPTY_COUNTS);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingWorkers, setLoadingWorkers] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [jobBusyId, setJobBusyId] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [workerPurgeBusy, setWorkerPurgeBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<JobReconcilePayload | null>(null);

  const [jobPage, setJobPage] = useState(1);
  const [jobType, setJobType] = useState<"" | JobType>("");
  const [jobStatus, setJobStatus] = useState<"" | JobStatus>("");
  const [jobUserId, setJobUserId] = useState("");
  const [staleMinutes, setStaleMinutes] = useState(10);
  const [cleanupOlderDays, setCleanupOlderDays] = useState(30);
  const [cleanupScope, setCleanupScope] = useState<CleanupScope>("safe");
  const [cleanupStatuses, setCleanupStatuses] = useState<Record<CleanupStatus, boolean>>({
    SUCCEEDED: true,
    FAILED: true,
    CANCELED: true,
  });
  const [fullCleanupStatuses, setFullCleanupStatuses] = useState<Record<JobStatus, boolean>>({
    PENDING: false,
    RUNNING: false,
    SUCCEEDED: true,
    FAILED: true,
    CANCELED: true,
  });
  const [cleanupConfirmCode, setCleanupConfirmCode] = useState("");

  const parseJson = useCallback(async <T,>(response: Response): Promise<T> => {
    let payload: (T & ApiErrorPayload) | null = null;
    try {
      payload = await readJsonBody<T & ApiErrorPayload>(response);
    } catch {
      throw new Error("Server returned an invalid response.");
    }
    if (!response.ok) throw new Error(parseError(payload ?? { error: resolveClientResponseError(response, payload, "Request failed.") }));
    if (!payload) throw new Error("Server returned an empty response.");
    return payload;
  }, []);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (response.status === 401) {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
      router.push("/login?reason=session-expired");
      throw new Error("Unauthorized");
    }
    return parseJson<T>(response);
  }, [parseJson, router]);

  const loadWorkers = useCallback(async (nextStaleMinutes = staleMinutes) => {
    setLoadingWorkers(true);
    setError(null);
    try {
      const payload = await fetchJson<WorkersPayload>(`/api/admin/workers?staleMinutes=${nextStaleMinutes}`);
      setWorkers(Array.isArray(payload.workers) ? payload.workers : []);
      setWorkerSummary(payload.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "워커 조회 중 오류가 발생했습니다.");
      setWorkers([]);
      setWorkerSummary(null);
    } finally {
      setLoadingWorkers(false);
    }
  }, [fetchJson, staleMinutes]);

  const loadJobs = useCallback(async (page = jobPage, silent = false) => {
    const safePage = Math.max(1, Math.trunc(page));
    if (!silent) {
      setLoadingJobs(true);
    }
    setError(null);

    const query = new URLSearchParams({
      page: String(safePage),
      limit: "50",
    });
    if (jobType) {
      query.set("type", jobType);
    }
    if (jobStatus) {
      query.set("status", jobStatus);
    }
    if (jobUserId.trim()) {
      query.set("userId", jobUserId.trim());
    }

    try {
      const payload = await fetchJson<AdminJobsPayload>(`/api/admin/jobs?${query.toString()}`);
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      setPagination(payload.pagination ?? null);
      setJobPage(payload.pagination?.page ?? safePage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업 조회 중 오류가 발생했습니다.");
      setJobs([]);
      setPagination(null);
    } finally {
      setLoadingJobs(false);
    }
  }, [fetchJson, jobStatus, jobType, jobUserId, jobPage]);

  const loadJobCounts = useCallback(async () => {
    setLoadingSummary(true);
    setError(null);
    try {
      const requests = (Object.keys(EMPTY_COUNTS) as JobStatus[]).map((status) => {
        return fetchJson<AdminJobsPayload>(`/api/admin/jobs?status=${status}&limit=1`);
      });
      const responses = await Promise.all(requests);
      const nextCounts: Record<JobStatus, number> = { ...EMPTY_COUNTS };
      (Object.keys(EMPTY_COUNTS) as JobStatus[]).forEach((status, idx) => {
        nextCounts[status] = responses[idx]?.pagination?.total ?? 0;
      });
      setJobCounts(nextCounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업 상태 집계 중 오류가 발생했습니다.");
      setJobCounts(EMPTY_COUNTS);
    } finally {
      setLoadingSummary(false);
    }
  }, [fetchJson]);

  const loadReconcile = useCallback(async () => {
    setReconcileBusy(true);
    try {
      const payload = await fetchJson<JobReconcilePayload>("/api/admin/jobs/reconcile");
      setReconcileResult(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "작업 큐 상태 점검 중 오류가 발생했습니다.");
      setReconcileResult(null);
    } finally {
      setReconcileBusy(false);
    }
  }, [fetchJson]);
  const refreshAll = useCallback(() => {
    void Promise.all([
      loadJobs(jobPage, false),
      loadWorkers(staleMinutes),
      loadJobCounts(),
      loadReconcile(),
    ]);
  }, [jobPage, loadJobs, loadWorkers, loadJobCounts, loadReconcile, staleMinutes]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!message) return;
    toast.success(message, {
      duration: 2800,
      closeButton: true,
    });
    setMessage(null);
  }, [message]);

  const applyFilters = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadJobs(1, false);
  }, [loadJobs]);

  const goPage = useCallback((next: number) => {
    if (!pagination || jobBusyId) return;
    const safePage = Math.max(1, Math.min(next, pagination.totalPages || 1));
    if (safePage === pagination.page) return;
    setJobPage(safePage);
    void loadJobs(safePage, false);
  }, [jobBusyId, loadJobs, pagination]);

  const pageButtons = useMemo(() => {
    if (!pagination) return [] as number[];
    const total = pagination.totalPages || 1;
    const current = pagination.page || 1;
    const maxButtons = 8;
    const start = Math.max(1, current - Math.floor(maxButtons / 2));
    const end = Math.min(total, start + maxButtons - 1);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [pagination]);

  const isActiveWorker = useCallback((lastSeenAt: string) => {
    if (!workerSummary) return false;
    const last = new Date(lastSeenAt);
    if (Number.isNaN(last.getTime())) return false;
    const cutoff = new Date(workerSummary.staleCutoff);
    return last.getTime() >= cutoff.getTime();
  }, [workerSummary]);

  const workerRefreshMinutes = useMemo(() => {
    const stale = workerSummary?.staleMinutes ?? staleMinutes;
    return stale > 0 ? stale : staleMinutes;
  }, [staleMinutes, workerSummary]);

  const workerCountsText = useMemo(() => {
    if (!workerSummary) return "로딩 중...";
    return `전체 ${workerSummary.total} / 활성 ${workerSummary.active} / 비활성 ${workerSummary.stale}`;
  }, [workerSummary]);

  const jobSummaryText = useMemo(() => {
    return `대기 ${jobCounts.PENDING} / 실행중 ${jobCounts.RUNNING} / 실패 ${jobCounts.FAILED} / 취소 ${jobCounts.CANCELED} / 성공 ${jobCounts.SUCCEEDED}`;
  }, [jobCounts]);

  const canCancelJob = useCallback((status: JobStatus) => status === "PENDING" || status === "RUNNING", []);

  const canRetryJob = useCallback((status: JobStatus) => status === "FAILED" || status === "CANCELED", []);

  const cleanupPayloadStatuses = useMemo(() => {
    if (cleanupScope === "full") {
      return CLEANUP_STATUSES_FULL.filter((status) => fullCleanupStatuses[status]);
    }
    return CLEANUP_STATUSES_SAFE.filter((status) => cleanupStatuses[status]);
  }, [cleanupScope, cleanupStatuses, fullCleanupStatuses]);

  const purgeWorkers = useCallback(() => {
    if (workerPurgeBusy || loadingWorkers) return;
    if (!window.confirm("워커 heartbeat 전체를 삭제할까요?")) return;

    setWorkerPurgeBusy(true);
    setError(null);
    void (async () => {
      try {
        const payload = await fetchJson<WorkerPurgePayload>("/api/admin/workers", {
          method: "DELETE",
        });
        setMessage(`워커 heartbeat ${payload.deleted}건 삭제`);
        await loadWorkers(staleMinutes);
        await loadReconcile();
      } catch (err) {
        setError(err instanceof Error ? err.message : "워커 삭제에 실패했습니다.");
      } finally {
        setWorkerPurgeBusy(false);
      }
    })();
  }, [fetchJson, loadReconcile, loadWorkers, loadingWorkers, staleMinutes, workerPurgeBusy]);

  const runReconcile = useCallback(() => {
    void loadReconcile();
  }, [loadReconcile]);

  const runCleanup = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (cleanupScope === "full" && cleanupConfirmCode.trim() !== CLEANUP_CONFIRM_CODE) {
        setError(`전체 정리 실행에는 확인 코드가 필요합니다. (${CLEANUP_CONFIRM_CODE})`);
        return;
      }
      if (cleanupPayloadStatuses.length === 0) {
        setError("최소 1개 이상의 상태를 선택해 주세요.");
        return;
      }
      if (cleanupOlderDays < 1) {
        setError("정리 기준일은 1일 이상이어야 합니다.");
        return;
      }

      setCleanupBusy(true);
      setError(null);
      void (async () => {
        try {
          const payload = await fetchJson<CleanupPayload>("/api/admin/jobs/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              olderThanDays: cleanupOlderDays,
              statuses: cleanupPayloadStatuses,
              scope: cleanupScope,
              confirmCode: cleanupScope === "full" ? cleanupConfirmCode.trim() : undefined,
            }),
          });
          const selected = payload.statusFilter.join(", ");
          setMessage(`작업 정리 완료: ${payload.deleted}건 삭제 (${payload.scope.toUpperCase()}: ${selected})`);
          await Promise.all([loadJobCounts(), loadJobs(jobPage, true), loadReconcile()]);
        } catch (err) {
          setError(err instanceof Error ? err.message : "작업 정리에 실패했습니다.");
        } finally {
          setCleanupBusy(false);
        }
      })();
    },
    [cleanupOlderDays, cleanupPayloadStatuses, cleanupScope, cleanupConfirmCode, fetchJson, jobPage, loadJobCounts, loadJobs, loadReconcile],
  );

  const runFullReset = useCallback(() => {
    if (resetBusy) return;
    if (!window.confirm(`DB와 워커 하트를 모두 삭제합니다.\n진행 중 작업도 함께 삭제되며 되돌릴 수 없습니다.\n계속하시겠습니까?`)) {
      return;
    }
    setResetBusy(true);
    setError(null);
    void (async () => {
      try {
        const [jobsPayload, workersPayload] = await Promise.all([
          fetchJson<CleanupPayload>("/api/admin/jobs/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              olderThanDays: 3650,
              scope: "full",
              statuses: CLEANUP_STATUSES_FULL,
              confirmCode: CLEANUP_CONFIRM_CODE,
            }),
          }),
          fetchJson<WorkerPurgePayload>("/api/admin/workers", {
            method: "DELETE",
          }),
        ]);
        setMessage(`초기화 완료: 작업 ${jobsPayload.deleted}건, 워커 ${workersPayload.deleted}건 삭제`);
        await refreshAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : "전체 초기화에 실패했습니다.");
      } finally {
        setResetBusy(false);
      }
    })();
  }, [fetchJson, refreshAll, resetBusy]);
  const cancelJob = useCallback((job: AdminJob) => {
    if (!canCancelJob(job.status) || jobBusyId) return;
    setJobBusyId(job.id);
    void (async () => {
      setError(null);
      try {
        await fetchJson(`/api/admin/jobs/${job.id}/cancel`, { method: "POST" });
        setMessage(`작업 ${job.id} 취소를 요청했습니다.`);
        await loadJobs(jobPage, true);
        await loadJobCounts();
        await loadReconcile();
      } catch (err) {
        setError(err instanceof Error ? err.message : "작업 취소에 실패했습니다.");
      } finally {
        setJobBusyId(null);
      }
    })();
  }, [canCancelJob, fetchJson, jobBusyId, jobPage, loadJobs, loadJobCounts, loadReconcile]);

  const retryJob = useCallback((job: AdminJob) => {
    if (!canRetryJob(job.status) || jobBusyId) return;
    setJobBusyId(job.id);
    void (async () => {
      setError(null);
      try {
        await fetchJson(`/api/admin/jobs/${job.id}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        setMessage(`작업 ${job.id} 재실행을 요청했습니다.`);
        await loadJobs(jobPage, true);
        await loadJobCounts();
        await loadReconcile();
      } catch (err) {
        setError(err instanceof Error ? err.message : "작업 재실행에 실패했습니다.");
      } finally {
        setJobBusyId(null);
      }
    })();
  }, [canRetryJob, fetchJson, jobBusyId, jobPage, loadJobs, loadJobCounts, loadReconcile]);

  const toggleCleanupStatus = useCallback((scope: CleanupScope, status: JobStatus, checked: boolean) => {
    if (scope === "safe") {
      setCleanupStatuses((previous) => ({
        ...previous,
        [status]: checked,
      }));
      return;
    }

    setFullCleanupStatuses((previous) => ({
      ...previous,
      [status]: checked,
    }));
  }, []);

  return (
    <main className="dashboard-main page-shell">
      <AppTopbar
        title="운영 도구"
        kicker="시스템 운영"
        email={initialUser.email}
        role={initialUser.role}
        onDashboard={() => router.push("/dashboard")}
        onGoAdmin={() => router.push("/admin")}
        onLogout={() => {
          void fetchJson("/api/auth/logout", { method: "POST" }).then(() => {
            router.push("/login");
            router.refresh();
          });
        }}
      />
      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>전체 작업</h2>
          <p className="metric">{pagination?.total ?? 0}</p>
          <p className="muted">페이지 기준 필터된 작업 개수</p>
        </article>
        <article className="admin-stat card">
          <h2>진행중 작업</h2>
          <p className="metric">{loadingSummary ? "..." : `${jobCounts.PENDING + jobCounts.RUNNING}`}</p>
          <p className="muted">{loadingSummary ? "로딩 중..." : jobSummaryText}</p>
        </article>
        <article className="admin-stat card">
          <h2>워커</h2>
          <p className="metric">{workerSummary?.active ?? 0}</p>
          <p className="muted">{`전체 ${workerSummary?.total ?? 0}, 비활성 ${workerSummary?.stale ?? 0} (기준 ${workerRefreshMinutes}분)`}</p>
        </article>
        <article className="admin-stat card">
          <h2>마지막 점검</h2>
          <p className="metric">{workerSummary ? formatDateTime(workerSummary.capturedAt) : "-"}</p>
          <p className="muted">{workerSummary ? "워커 하트비트 수집 시각" : "수집 이력 없음"}</p>
        </article>
      </section>

      <section className="card">
        <div className="button-row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          <Link className="ghost-btn" href="/admin/operations">
            작업 운영 개요
          </Link>
          <Link className="ghost-btn" href={"/admin/operations/jobs" as Route}>
            작업 목록
          </Link>
          <Link className="ghost-btn" href={"/admin/operations/workers" as Route}>
            워커 목록
          </Link>
          <Link className="ghost-btn" href={"/admin/operations/reconcile" as Route}>
            정합성 점검
          </Link>
          <Link className="ghost-btn" href={"/admin/operations/cleanup" as Route}>
            작업 정리
          </Link>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      {view === "overview" ? (
      <section className="card">
        <div className="status-grid">
          <article className="card admin-stat">
            <p className="muted">작업 상세</p>
            <p className="metric">{pagination?.total ?? 0}</p>
            <p className="muted">필터와 재시도/취소 관리는 작업 목록 페이지에서 진행합니다.</p>
            <Link className="ghost-btn" href={"/admin/operations/jobs" as Route}>작업 목록 열기</Link>
          </article>
          <article className="card admin-stat">
            <p className="muted">워커 상태</p>
            <p className="metric">{workerSummary?.active ?? 0}</p>
            <p className="muted">heartbeat 조회와 정리는 워커 목록 페이지에서 진행합니다.</p>
            <Link className="ghost-btn" href={"/admin/operations/workers" as Route}>워커 목록 열기</Link>
          </article>
          <article className="card admin-stat">
            <p className="muted">정합성 점검</p>
            <p className="metric">{reconcileResult?.summary.orphanedRunningJobsCount ?? 0}</p>
            <p className="muted">DB RUNNING과 GitHub Action 불일치를 점검합니다.</p>
            <Link className="ghost-btn" href={"/admin/operations/reconcile" as Route}>정합성 점검 열기</Link>
          </article>
          <article className="card admin-stat">
            <p className="muted">작업 정리</p>
            <p className="metric">{cleanupOlderDays}</p>
            <p className="muted">오래된 작업 정리와 전체 초기화는 전용 페이지에서 실행합니다.</p>
            <Link className="ghost-btn" href={"/admin/operations/cleanup" as Route}>정리 페이지 열기</Link>
          </article>
        </div>
      </section>
      ) : null}

      {view === "jobs" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>작업 목록</h2>
          <span className="muted text-small">{workerCountsText}</span>
        </div>
        <form className="form-grid top-gap" onSubmit={applyFilters}>
          <label className="field">
            <span>작업 타입</span>
            <select value={jobType} onChange={(event) => setJobType(event.target.value as "" | JobType)}>
              {JOB_TYPE_OPTIONS.map((type) => (
                <option key={type || "all"} value={type}>
                  {type || "전체"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>상태</span>
            <select value={jobStatus} onChange={(event) => setJobStatus(event.target.value as "" | JobStatus)}>
              {JOB_STATUS_OPTIONS.map((status) => (
                <option key={status || "all"} value={status}>
                  {status ? JOB_STATUS_LABELS[status] : "전체"}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>사용자 ID</span>
            <input value={jobUserId} onChange={(event) => setJobUserId(event.target.value)} placeholder="UUID 입력" />
          </label>
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={loadingJobs}>
              {loadingJobs ? "조회 중..." : "조회"}
            </button>
          </div>
        </form>
        <div className="table-wrap top-gap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>작업 ID</th>
                <th>사용자</th>
                <th>타입</th>
                <th>상태</th>
                <th>재시도</th>
                <th>워커</th>
                <th>실행 예정</th>
                <th>최종 에러</th>
                <th>동작</th>
              </tr>
            </thead>
            <tbody>
              {loadingJobs ? (
                <tr>
                  <td colSpan={9}>로딩 중...</td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={9}>조회된 작업이 없습니다.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td data-label="Job ID">{job.id}</td>
                    <td data-label="User">{job.user?.email ?? job.userId}</td>
                    <td data-label="Type">{job.type}</td>
                    <td data-label="Status">
                      <span className={`status-chip ${statusClassForJob(job.status)}`}>{JOB_STATUS_LABELS[job.status]}</span>
                    </td>
                    <td data-label="Attempts">{job.attempts}</td>
                    <td data-label="Worker">{job.workerId ?? "-"}</td>
                    <td data-label="Run After">{formatDateTime(job.runAfter)}</td>
                    <td data-label="Last Error">
                      <span className="muted" style={{ maxWidth: 260, display: "inline-block", overflowWrap: "anywhere" }}>
                        {job.lastError ?? "-"}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="action-row">
                        <button
                          type="button"
                          className="btn-success"
                          disabled={jobBusyId === job.id || !canRetryJob(job.status)}
                          onClick={() => void retryJob(job)}
                        >
                          {jobBusyId === job.id ? (
                            <>
                              <RotateCw size={14} />
                              처리 중...
                            </>
                          ) : (
                            "재실행"
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={jobBusyId === job.id || !canCancelJob(job.status)}
                          onClick={() => void cancelJob(job)}
                        >
                          {jobBusyId === job.id ? "처리 중..." : "취소"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 ? (
          <div className="pagination">
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goPage((pagination.page ?? 1) - 1)}
              disabled={!pagination.hasPrevPage || loadingJobs}
            >
              이전
            </button>
            {pageButtons.map((page) => (
              <button
                type="button"
                key={page}
                className={`pagination-button ghost-btn${(pagination.page ?? 1) === page ? " active" : ""}`}
                onClick={() => goPage(page)}
                disabled={loadingJobs}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              className="pagination-button ghost-btn"
              onClick={() => goPage((pagination.page ?? 1) + 1)}
              disabled={!pagination.hasNextPage || loadingJobs}
            >
              다음
            </button>
          </div>
        ) : null}
      </section>
      ) : null}

      {view === "workers" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>워커 목록</h2>
          <label className="field">
            <span>기준 분(min)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={staleMinutes}
              onChange={(event) => setStaleMinutes(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button className="ghost-btn" type="button" onClick={() => void loadWorkers(staleMinutes)} disabled={loadingWorkers}>
            갱신
          </button>
          <button
            className="btn-danger"
            type="button"
            onClick={purgeWorkers}
            disabled={workerPurgeBusy || loadingWorkers}
          >
            {workerPurgeBusy ? "삭제 중..." : "워커 heartbeat 전체 삭제"}
          </button>
        </div>
        <div className="table-wrap top-gap mobile-card-table">
          <table>
            <thead>
              <tr>
                <th>워커 ID</th>
                <th>마지막 heartbeat</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {loadingWorkers ? (
                <tr>
                  <td colSpan={3}>로딩 중...</td>
                </tr>
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={3}>워커가 없습니다.</td>
                </tr>
              ) : (
                workers.map((worker) => {
                  const active = isActiveWorker(worker.lastSeenAt);
                  return (
                    <tr key={worker.workerId}>
                      <td data-label="Worker ID">{worker.workerId}</td>
                      <td data-label="Last Heartbeat">{formatDateTime(worker.lastSeenAt)}</td>
                      <td data-label="Status">
                        <span className={`status-chip ${active ? "status-active" : "status-failed"}`}>
                          {active ? "정상" : "비정상"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      {view === "reconcile" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>RUNNING vs GitHub Action 불일치 점검</h2>
          <button className="btn-success" type="button" onClick={() => void runReconcile()} disabled={reconcileBusy}>
            {reconcileBusy ? "점검 중..." : "불일치 점검"}
          </button>
        </div>
        {reconcileResult ? (
          <div className="top-gap">
            <p className="muted">점검 시각: {formatDateTime(reconcileResult.checkedAt)}</p>
            {(reconcileResult.scheduleChecks?.length ?? 0) > 0 ? (
              <div className="top-gap">
                <h3 className="muted">Workflow schedule checks</h3>
                <div className="table-wrap mobile-card-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Expected cron</th>
                        <th>Actual cron</th>
                        <th>Status</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconcileResult.scheduleChecks?.map((item) => (
                        <tr key={`${item.key}:${item.workflowPath}`}>
                          <td data-label="Target">{item.key.toUpperCase()}</td>
                          <td data-label="Expected cron">{item.expectedCrons.join(", ") || "-"}</td>
                          <td data-label="Actual cron">{item.actualCrons.join(", ") || "-"}</td>
                          <td data-label="Status">
                            <span className={`status-chip ${statusClassForSchedule(item.status)}`}>
                              {item.status}
                            </span>
                          </td>
                          <td data-label="Message">
                            <span className="muted" style={{ overflowWrap: "anywhere" }}>{item.message}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {reconcileResult.canReconcileWithGitHub ? (
              <div className="status-grid top-gap">
                <article className="card admin-stat">
                  <p className="muted">DB RUNNING</p>
                  <p className="metric">{reconcileResult.summary.runningJobsCount}</p>
                </article>
                <article className="card admin-stat">
                  <p className="muted">미일치 실행중 (DB에만 존재)</p>
                  <p className="metric">{reconcileResult.summary.orphanedRunningJobsCount}</p>
                </article>
                <article className="card admin-stat">
                  <p className="muted">GitHub Active Runs</p>
                  <p className="metric">{reconcileResult.summary.activeRunsCount}</p>
                </article>
                <article className="card admin-stat">
                  <p className="muted">미일치 실행중 (GitHub만 존재)</p>
                  <p className="metric">{reconcileResult.summary.ghostRunsCount}</p>
                </article>
              </div>
            ) : (
              <p className="error-text">
                GitHub 조회 설정이 없어 정합성 점검을 완료할 수 없습니다. ({reconcileResult.error ?? "확인 불가"})
              </p>
            )}
            {reconcileResult.summary.nonparseableWorkerIdCount > 0 ? (
              <p className="muted text-small">workerId 파싱 불가: {reconcileResult.summary.nonparseableWorkerIdCount}건</p>
            ) : null}
            {(reconcileResult.orphanedRunningJobs.length > 0 || reconcileResult.ghostRuns.length > 0) ? (
              <div className="top-gap">
                <h3 className="muted">예시 상세</h3>
                {reconcileResult.orphanedRunningJobs.length > 0 ? (
                  <details>
                    <summary className="muted">DB에만 남은 RUNNING 작업 {reconcileResult.orphanedRunningJobs.length}건</summary>
                    <ul>
                      {reconcileResult.orphanedRunningJobs.slice(0, 20).map((job) => (
                        <li key={job.id}>
                          {job.id} / {job.userId} / {job.type}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {reconcileResult.ghostRuns.length > 0 ? (
                  <details>
                    <summary className="muted">GitHub에만 있는 실행 {reconcileResult.ghostRuns.length}건</summary>
                    <ul>
                      {reconcileResult.ghostRuns.slice(0, 20).map((run) => (
                        <li key={run.id}>
                          <a href={run.htmlUrl} target="_blank" rel="noreferrer">
                            run #{run.id}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">점검 결과가 없습니다. 점검 버튼을 눌러주세요.</p>
        )}
      </section>
      ) : null}

      {view === "cleanup" ? (
      <section className="card">
        <div className="table-toolbar">
          <h2>작업 정리</h2>
          <span className="muted text-small">기본은 성공/실패/취소 상태만 정리합니다.</span>
        </div>
        <form className="form-grid top-gap" onSubmit={runCleanup}>
          <label className="field">
            <span>오래된 기준일(일)</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={cleanupOlderDays}
              onChange={(event) => setCleanupOlderDays(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <label className="field">
            <span>정리 범위</span>
            <div className="action-row">
              {CLEANUP_SCOPE_OPTIONS.map((scope) => (
                <label className="check-field" key={scope}>
                  <input
                    type="radio"
                    value={scope}
                    checked={cleanupScope === scope}
                    onChange={() => {
                      setCleanupScope(scope);
                      if (scope === "safe") {
                        setCleanupConfirmCode("");
                      }
                    }}
                  />
                  <span>{CLEANUP_SCOPE_LABELS[scope]}</span>
                </label>
              ))}
            </div>
          </label>
          <label className="field">
            <span>상태 선택</span>
            <div className="action-row">
              {(cleanupScope === "safe" ? CLEANUP_STATUSES_SAFE : CLEANUP_STATUSES_FULL).map((status) => (
                <label className="check-field" key={status}>
                  <input
                    type="checkbox"
                    checked={
                      cleanupScope === "safe"
                        ? cleanupStatuses[status as CleanupStatus]
                        : fullCleanupStatuses[status]
                    }
                    onChange={(event) => {
                      toggleCleanupStatus(cleanupScope, status, event.currentTarget.checked);
                    }}
                  />
                  <span>{JOB_STATUS_LABELS[status as JobStatus]}</span>
                </label>
              ))}
            </div>
          </label>
          {cleanupScope === "full" ? (
            <label className="field">
              <span>확인 코드</span>
              <input
                type="text"
                value={cleanupConfirmCode}
                onChange={(event) => setCleanupConfirmCode(event.target.value)}
                placeholder={CLEANUP_CONFIRM_CODE}
                autoComplete="off"
              />
              <small className="muted">PENDING/RUNNING이 포함된 정리 실행 시 반드시 필요합니다.</small>
            </label>
          ) : null}
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={cleanupBusy}>
              {cleanupBusy ? "정리 중..." : "선택 정리 실행"}
            </button>
          </div>
        </form>

        <div className="top-gap">
          <button className="btn-danger" type="button" onClick={runFullReset} disabled={resetBusy}>
            {resetBusy ? "초기화 중..." : "워커/작업 큐 전체 초기화"}
          </button>
          <p className="muted" style={{ marginTop: 8 }}>
            전체 초기화는 작업 큐 + 워커 heartbeat를 모두 삭제합니다. 작업 정합성 점검에서 사용되지 않는 잔여 항목 정리에 활용하세요.
          </p>
        </div>
      </section>
      ) : null}
    </main>
  );
}
