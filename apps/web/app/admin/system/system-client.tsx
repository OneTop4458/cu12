"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "../../../components/theme/theme-toggle";
import { UserMenu } from "../../../components/layout/user-menu";

type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
type NoticeType = "BROADCAST" | "MAINTENANCE";

interface AdminSystemProps {
  initialUser: {
    email: string;
    role: "ADMIN" | "USER";
  };
}

interface ApiErrorPayload {
  error?: string;
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

interface AdminJobsPayload {
  pagination: {
    total: number;
  };
}

interface SiteNotice {
  id: string;
  title: string;
  message: string;
  type: NoticeType;
  isActive: boolean;
  priority: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SiteNoticesPayload {
  siteNotices: SiteNotice[];
}

interface HealthPayload {
  ok: boolean;
}

const JOB_STATUSES: JobStatus[] = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"];

const NOTICE_TYPE_LABEL: Record<NoticeType, string> = {
  BROADCAST: "전체 공지",
  MAINTENANCE: "시스템 점검",
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

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

const EMPTY_COUNTS: Record<JobStatus, number> = {
  PENDING: 0,
  RUNNING: 0,
  SUCCEEDED: 0,
  FAILED: 0,
  CANCELED: 0,
};

export function AdminSystemClient({ initialUser }: AdminSystemProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [workers, setWorkers] = useState<WorkerHeartbeat[]>([]);
  const [workerSummary, setWorkerSummary] = useState<WorkersPayload["summary"] | null>(null);
  const [jobCounts, setJobCounts] = useState<Record<JobStatus, number>>(EMPTY_COUNTS);
  const [staleMinutes, setStaleMinutes] = useState(10);
  const [siteNotices, setSiteNotices] = useState<SiteNotice[]>([]);

  const fetchJson = useCallback(async <T,>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
      throw new Error(parseError(payload));
    }
    return (await response.json()) as T;
  }, []);

  const fetchHealth = useCallback(async () => {
    const payload = await fetchJson<HealthPayload>("/api/health");
    setHealthOk(Boolean(payload.ok));
  }, [fetchJson]);

  const fetchWorkers = useCallback(async () => {
    const payload = await fetchJson<WorkersPayload>(`/api/admin/workers?staleMinutes=${Math.max(1, Math.trunc(staleMinutes))}`);
    setWorkers(payload.workers ?? []);
    setWorkerSummary(payload.summary ?? null);
  }, [fetchJson, staleMinutes]);

  const fetchJobs = useCallback(async () => {
    const responses = await Promise.all(
      JOB_STATUSES.map((status) =>
        fetchJson<AdminJobsPayload>(`/api/admin/jobs?status=${status}&limit=1`),
      ),
    );

    const nextCounts = { ...EMPTY_COUNTS };
    responses.forEach((response, index) => {
      const status = JOB_STATUSES[index];
      if (status) {
        nextCounts[status] = response.pagination?.total ?? 0;
      }
    });
    setJobCounts(nextCounts);
  }, [fetchJson]);

  const fetchSiteNotices = useCallback(async () => {
    const payload = await fetchJson<SiteNoticesPayload>("/api/admin/site-notices?includeInactive=1");
    setSiteNotices(payload.siteNotices ?? []);
  }, [fetchJson]);

  const refreshAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      await Promise.all([
        fetchHealth(),
        fetchWorkers(),
        fetchJobs(),
        fetchSiteNotices(),
      ]);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "시스템 상태를 불러오지 못했습니다.";
      setError(messageText);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchHealth, fetchJobs, fetchSiteNotices, fetchWorkers]);

  useEffect(() => {
    void refreshAll(false);
  }, [refreshAll]);

  const activeNotices = useMemo(() => siteNotices.filter((notice) => notice.isActive), [siteNotices]);
  const activeBroadcast = useMemo(() => activeNotices.filter((notice) => notice.type === "BROADCAST").length, [activeNotices]);
  const activeMaintenance = useMemo(() => activeNotices.filter((notice) => notice.type === "MAINTENANCE").length, [activeNotices]);
  const jobTotal = useMemo(
    () => Object.values(jobCounts).reduce((acc, value) => acc + value, 0),
    [jobCounts],
  );
  const sortedNotices = useMemo(() => {
    return [...siteNotices].sort((a, b) => {
      if (a.isActive !== b.isActive) {
        return a.isActive ? -1 : 1;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [siteNotices]);

  return (
    <main className="dashboard-main page-shell">
      <header className="topbar topbar-fixed">
        <div className="topbar-main">
          <div className="topbar-brand">
            <img src="/brand/catholic/crest-mark.png" alt="Catholic University crest" loading="lazy" />
            <div>
              <p className="brand-kicker">가톨릭대학교 공유대학 운영</p>
              <h1>시스템 상태</h1>
              <p className="muted">운영자: {initialUser.email}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={() => void refreshAll(true)}
              disabled={loading || refreshing}
              title="새로고침"
            >
              <RefreshCw size={16} />
            </button>
            <Link className="ghost-btn" href="/admin/site-notices" as="/admin/site-notices" >
              공지/점검 설정
            </Link>
            <Link className="ghost-btn" href={"/admin/operations" as any} as={"/admin/operations" as any} >
              작업 운영
            </Link>
            <Link className="ghost-btn" href="/admin" as="/admin" >
              관리 홈
            </Link>
            <ThemeToggle />
            <UserMenu
              email={initialUser.email}
              role={initialUser.role}
              impersonating={false}
              onDashboard={() => router.push("/dashboard")}
              onGoAdmin={() => router.push("/admin")}
              onLogout={() => {
                void fetch("/api/auth/logout", { method: "POST" }).then(() => {
                  router.push("/login");
                  router.refresh();
                });
              }}
            />
          </div>
        </div>
      </header>
      <div className="topbar-spacer" aria-hidden="true" />

      {loading ? <p className="muted">시스템 상태를 불러오는 중입니다...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <section className="admin-stats">
        <article className="admin-stat card">
          <h2>헬스 체크</h2>
          <p className="metric">{healthOk === null ? "-" : healthOk ? "정상" : "비정상"}</p>
          <p className="muted">서버 상태</p>
        </article>
        <article className="admin-stat card">
          <h2>워커 상태</h2>
          <p className="metric">{workerSummary ? `${workerSummary.active}/${workerSummary.total}` : "0/0"}</p>
          <p className="muted">활성 / 전체</p>
        </article>
        <article className="admin-stat card">
          <h2>작업 큐</h2>
          <p className="metric">{jobTotal}</p>
          <p className="muted">총 작업 수</p>
        </article>
        <article className="admin-stat card">
          <h2>현재 공지</h2>
          <p className="metric">{activeNotices.length}</p>
          <p className="muted">전체 {activeBroadcast} / 점검 {activeMaintenance}</p>
        </article>
      </section>

      <section className="card">
        <div className="table-toolbar">
          <h2>작업 큐 상태</h2>
          <span className="muted text-small">FAILED/CANCELED는 실패/중단 건수입니다.</span>
        </div>
        <div className="status-grid top-gap">
          {JOB_STATUSES.map((status) => (
            <article key={status} className="card admin-stat">
              <p className="muted">{status}</p>
              <p className="metric">{jobCounts[status] ?? 0}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="table-toolbar">
          <h2>워커 상태</h2>
          <label className="field">
            <span>비정상 판별 기준(분)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={staleMinutes}
              onChange={(event) => setStaleMinutes(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <button type="button" className="btn-success" onClick={() => void refreshAll(true)} disabled={loading || refreshing}>
            {refreshing ? "갱신 중..." : "워커 다시 조회"}
          </button>
        </div>
        <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>최종 heartbeat</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {!workerSummary || workers.length === 0 ? (
                <tr>
                  <td colSpan={3}>워커가 등록되어 있지 않습니다.</td>
                </tr>
              ) : (
                workers.map((worker) => {
                  const isActive = workerSummary
                    ? new Date(worker.lastSeenAt).getTime() >= new Date(workerSummary.staleCutoff).getTime()
                    : false;
                  return (
                    <tr key={worker.workerId}>
                      <td>{worker.workerId}</td>
                      <td>{formatDate(worker.lastSeenAt)}</td>
                      <td>
                        <span className={`status-chip ${isActive ? "status-active" : "status-failed"}`}>
                          {isActive ? "정상" : "비정상"}
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
        <h2>현재 공지/점검 목록</h2>
        <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>
                <th>유형</th>
                <th>제목</th>
                <th>우선순위</th>
                <th>상태</th>
                <th>표시 시작</th>
                <th>표시 종료</th>
              </tr>
            </thead>
            <tbody>
              {sortedNotices.length === 0 ? (
                <tr>
                  <td colSpan={6}>등록된 공지가 없습니다.</td>
                </tr>
              ) : (
                sortedNotices.slice(0, 30).map((notice) => (
                  <tr key={notice.id}>
                    <td>{NOTICE_TYPE_LABEL[notice.type]}</td>
                    <td>{notice.title}</td>
                    <td>{notice.priority}</td>
                    <td>{notice.isActive ? "활성" : "비활성"}</td>
                    <td>{formatDate(notice.visibleFrom)}</td>
                    <td>{formatDate(notice.visibleTo)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
