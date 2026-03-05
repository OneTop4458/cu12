"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, RefreshCw, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "../../../components/theme/theme-toggle";
import { UserMenu } from "../../../components/layout/user-menu";

type RoleType = "ADMIN" | "USER";
type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
type JobType = "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";

type CleanupStatus = "SUCCEEDED" | "FAILED" | "CANCELED";

interface AdminOperationsClientProps {
  initialUser: {
    email: string;
    role: RoleType;
  };
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
  olderThanDays: number;
  statusFilter: CleanupStatus[];
  cutoff: string;
}

interface ApiErrorPayload {
  error?: string;
  errorCode?: string;
}

const JOB_STATUS_OPTIONS: Array<JobStatus | ""> = ["", "PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];
const JOB_TYPE_OPTIONS: Array<JobType | ""> = ["", "SYNC", "AUTOLEARN", "NOTICE_SCAN", "MAIL_DIGEST"];
const CLEANUP_STATUSES: CleanupStatus[] = ["SUCCEEDED", "FAILED", "CANCELED"];

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  PENDING: "대기",
  RUNNING: "실행 중",
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
  return "알 수 없는 오류가 발생했습니다.";
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

export function AdminOperationsClient({ initialUser }: AdminOperationsClientProps) {
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

  const [jobPage, setJobPage] = useState(1);
  const [jobType, setJobType] = useState<"" | JobType>("");
  const [jobStatus, setJobStatus] = useState<"" | JobStatus>("");
  const [jobUserId, setJobUserId] = useState("");
  const [staleMinutes, setStaleMinutes] = useState(10);
  const [cleanupOlderDays, setCleanupOlderDays] = useState(30);
  const [cleanupStatuses, setCleanupStatuses] = useState<Record<CleanupStatus, boolean>>({
    SUCCEEDED: true,
    FAILED: true,
    CANCELED: true,
  });

  const parseJson = useCallback(async <T,>(response: Response): Promise<T> => {
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) throw new Error(parseError(payload));
    return payload;
  }, []);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (response.status === 401) {
      router.push("/login");
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
      setError(err instanceof Error ? err.message : "워커 목록 조회 중 오류가 발생했습니다.");
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
      setError(err instanceof Error ? err.message : "작업 목록 조회 중 오류가 발생했습니다.");
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

  const refreshAll = useCallback(() => {
    void loadJobs(jobPage, false);
    void loadWorkers(staleMinutes);
    void loadJobCounts();
  }, [jobPage, loadJobs, loadWorkers, loadJobCounts, staleMinutes]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

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

  const workerCountsText = useMemo(() => {
    if (!workerSummary) return "로딩 중..";
    return `총 ${workerSummary.total} / 활성 ${workerSummary.active} / 비활성 ${workerSummary.stale}`;
  }, [workerSummary]);

  const jobSummaryText = useMemo(() => {
    return `대기 ${jobCounts.PENDING} / 실행 중 ${jobCounts.RUNNING} / 실패 ${jobCounts.FAILED} / 취소 ${jobCounts.CANCELED} / 성공 ${jobCounts.SUCCEEDED}`;
  }, [jobCounts]);

  const canCancelJob = useCallback((status: JobStatus) => status === "PENDING" || status === "RUNNING", []);

  const canRetryJob = useCallback((status: JobStatus) => status === "FAILED" || status === "CANCELED", []);

  const cancelJob = useCallback((job: AdminJob) => {
    if (!canCancelJob(job.status) || jobBusyId) return;
    setJobBusyId(job.id);
    void (async () => {
      setError(null);
      try {
        await fetchJson(`/api/admin/jobs/${job.id}/cancel`, { method: "POST" });
        setMessage(`${job.id} 작업 취소 요청이 완료되었습니다.`);
        await loadJobs(jobPage, true);
        await loadJobCounts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "작업 취소 요청이 실패했습니다.");
      } finally {
        setJobBusyId(null);
      }
    })();
  }, [canCancelJob, fetchJson, jobBusyId, jobPage, loadJobs, loadJobCounts]);

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
        setMessage(`${job.id} 작업 재시도 요청이 완료되었습니다.`);
        await loadJobs(jobPage, true);
        await loadJobCounts();
      } catch (err) {
        setError(err instanceof Error ? err.message : "작업 재시도 요청이 실패했습니다.");
      } finally {
        setJobBusyId(null);
      }
    })();
  }, [canRetryJob, fetchJson, jobBusyId, jobPage, loadJobs, loadJobCounts]);

  const workerRefreshMinutes = useMemo(() => {
    const stale = workerSummary?.staleMinutes ?? staleMinutes;
    return stale > 0 ? stale : staleMinutes;
  }, [staleMinutes, workerSummary]);

  const cleanupPayloadText = useMemo(() => {
    const selected = CLEANUP_STATUSES.filter((status) => cleanupStatuses[status]);
    if (selected.length === 0) return [];
    return selected;
  }, [cleanupStatuses]);

  const runCleanup = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (cleanupPayloadText.length === 0) {
        setError("최소 1개 이상의 상태를 선택해 주세요.");
        return;
      }
      if (cleanupOlderDays < 1) {
        setError("보관 기간은 1 이상으로 입력해야 합니다.");
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
              statuses: cleanupPayloadText,
            }),
          });
          const selected = payload.statusFilter.join(", ");
          setMessage(`작업 ${payload.deleted}개가 정리되었습니다. (상태: ${selected})`);
          await loadJobCounts();
          await loadJobs(jobPage, true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "작업 정리가 실패했습니다.");
        } finally {
          setCleanupBusy(false);
        }
      })();
    },
    [cleanupOlderDays, cleanupPayloadText, fetchJson, jobPage, loadJobCounts, loadJobs],
  );

  const toggleCleanupStatus = useCallback((status: CleanupStatus, checked: boolean) => {
    setCleanupStatuses((previous) => ({
      ...previous,
      [status]: checked,
    }));
  }, []);

  return (
    <main className="dashboard-main page-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-brand">
            <div>
              <p className="brand-kicker">관리자 작업</p>
              <h1>운영 | 작업/워커 운영</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" type="button" onClick={() => void refreshAll()} disabled={loadingJobs || loadingWorkers || loadingSummary}>
              <RefreshCw size={16} />
            </button>
            <ThemeToggle />
            <Link className="ghost-btn" href={"/admin/system" as any} as={"/admin/system" as any}>
              시스템 상태
            </Link>
            <button type="button" className="ghost-btn" onClick={() => router.push("/admin")}>
              <ChevronLeft size={16} />
              관리자 홈
            </button>
            <UserMenu
              email={initialUser.email}
              role={initialUser.role}
              impersonating={false}
              onDashboard={() => router.push("/dashboard")}
              onGoAdmin={() => router.push("/admin")}
              onLogout={() => {
                void fetchJson("/api/auth/logout", { method: "POST" }).then(() => {
                  router.push("/login");
                  router.refresh();
                });
              }}
            />
          </div>
        </div>
      </header>
      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>총 작업</h2>
          <p className="metric">{pagination?.total ?? 0}</p>
          <p className="muted">페이지 기준 처리된 작업 수</p>
        </article>
        <article className="admin-stat card">
          <h2>실행 작업</h2>
          <p className="metric">{loadingSummary ? "..." : `${jobCounts.PENDING + jobCounts.RUNNING}`}</p>
          <p className="muted">{loadingSummary ? "집계 중..." : jobSummaryText}</p>
        </article>
        <article className="admin-stat card">
          <h2>워커 상태</h2>
          <p className="metric">{workerSummary?.active ?? 0}</p>
          <p className="muted">{`총 ${workerSummary?.total ?? 0}, 비활성 ${workerSummary?.stale ?? 0} (기준 ${workerRefreshMinutes}분)`}</p>
        </article>
        <article className="admin-stat card">
          <h2>마지막 갱신</h2>
          <p className="metric">{workerSummary ? formatDateTime(workerSummary.capturedAt) : "-"}</p>
          <p className="muted">{workerSummary ? "워커 상태 업데이트 시간" : "워커 상태 없음"}</p>
        </article>
      </section>

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="card">
        <div className="table-toolbar">
          <h2>작업 목록</h2>
          <span className="muted text-small">{workerCountsText}</span>
        </div>
        <form className="form-grid top-gap" onSubmit={applyFilters}>
          <label className="field">
            <span>작업 유형</span>
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
            <span>요청 사용자 ID</span>
            <input value={jobUserId} onChange={(event) => setJobUserId(event.target.value)} placeholder="UUID 입력" />
          </label>
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={loadingJobs}>
              {loadingJobs ? "조회 중.." : "조회"}
            </button>
          </div>
        </form>
        <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>
                <th>작업 ID</th>
                <th>요청 사용자</th>
                <th>유형</th>
                <th>상태</th>
                <th>시도</th>
                <th>워커</th>
                <th>실행 예정</th>
                <th>최근 오류</th>
                <th>조치</th>
              </tr>
            </thead>
            <tbody>
              {loadingJobs ? (
                <tr>
                  <td colSpan={9}>로딩 중..</td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={9}>조회된 작업이 없습니다.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.user?.email ?? job.userId}</td>
                    <td>{job.type}</td>
                    <td>
                      <span className={`status-chip ${statusClassForJob(job.status)}`}>{JOB_STATUS_LABELS[job.status]}</span>
                    </td>
                    <td>{job.attempts}</td>
                    <td>{job.workerId ?? "-"}</td>
                    <td>{formatDateTime(job.runAfter)}</td>
                    <td>
                      <span className="muted" style={{ maxWidth: 260, display: "inline-block", overflowWrap: "anywhere" }}>
                        {job.lastError ?? "-"}
                      </span>
                    </td>
                    <td>
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
                              처리 중..
                            </>
                          ) : (
                            "재시도"
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={jobBusyId === job.id || !canCancelJob(job.status)}
                          onClick={() => void cancelJob(job)}
                        >
                          {jobBusyId === job.id ? "처리 중.." : "취소"}
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

      <section className="card">
        <div className="table-toolbar">
          <h2>워커 목록</h2>
          <label className="field">
            <span>비활성 기준(분)</span>
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
        </div>
        <div className="table-wrap top-gap">
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
                  <td colSpan={3}>로딩 중..</td>
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
                      <td>{worker.workerId}</td>
                      <td>{formatDateTime(worker.lastSeenAt)}</td>
                      <td>
                        <span className={`status-chip ${active ? "status-active" : "status-failed"}`}>
                          {active ? "활성" : "비활성"}
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

      <section className="card">
        <div className="table-toolbar">
          <h2>완료/실패/취소 작업 정리</h2>
          <span className="muted text-small">완료·실패·취소 작업만 기간 기준으로 정리됩니다.</span>
        </div>
        <form className="form-grid top-gap" onSubmit={runCleanup}>
          <label className="field">
            <span>보관 기간(일)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={cleanupOlderDays}
              onChange={(event) => setCleanupOlderDays(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <label className="field">
            <span>상태</span>
            <div className="action-row">
              {CLEANUP_STATUSES.map((status) => (
                <label className="check-field" key={status}>
                  <input
                    type="checkbox"
                    checked={cleanupStatuses[status]}
                    onChange={(event) => {
                      toggleCleanupStatus(status, event.currentTarget.checked);
                    }}
                  />
                  <span>{JOB_STATUS_LABELS[status]}</span>
                </label>
              ))}
            </div>
          </label>
          <div className="align-end">
            <button className="btn-success" type="submit" disabled={cleanupBusy}>
              {cleanupBusy ? "정리 중.." : "선택 작업 정리"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
