"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

interface DashboardClientProps {
  initialUser: {
    email: string;
    role: "ADMIN" | "USER";
  };
}

interface DashboardSummary {
  activeCourseCount: number;
  avgProgress: number;
  unreadNoticeCount: number;
  upcomingDeadlines: number;
  lastSyncAt: string | null;
}

interface CourseItem {
  lectureSeq: number;
  title: string;
  instructor: string | null;
  progressPercent: number;
  remainDays: number | null;
  status: "ACTIVE" | "UPCOMING" | "ENDED";
}

interface JobItem {
  id: string;
  type: "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  attempts: number;
  createdAt: string;
  lastError: string | null;
}

interface JobDispatchResponse {
  jobId: string;
  status: JobItem["status"];
  deduplicated: boolean;
  dispatched: boolean;
  dispatchError?: string;
  notice?: string;
}

interface JobDetailResponse {
  id: string;
  status: JobItem["status"];
  error?: string;
}

interface Cu12AccountResponse {
  account: {
    cu12Id: string;
    campus: "SONGSIM" | "SONGSIN";
    accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR";
    statusReason: string | null;
    autoLearnEnabled: boolean;
    detectActivitiesEnabled: boolean;
    emailDigestEnabled: boolean;
    updatedAt: string;
  } | null;
}

interface InviteItem {
  id: string;
  cu12Id: string;
  role: "ADMIN" | "USER";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  state: "ACTIVE" | "USED" | "EXPIRED";
}

const TERMINAL_JOB_STATUS = new Set<JobItem["status"]>([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
]);

function toDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR");
}

function jobTypeLabel(type: JobItem["type"]): string {
  switch (type) {
    case "SYNC":
      return "동기화";
    case "AUTOLEARN":
      return "자동 수강";
    case "NOTICE_SCAN":
      return "공지 스캔";
    case "MAIL_DIGEST":
      return "메일 요약";
    default:
      return type;
  }
}

function jobStatusLabel(status: JobItem["status"]): string {
  switch (status) {
    case "PENDING":
      return "대기";
    case "RUNNING":
      return "진행 중";
    case "SUCCEEDED":
      return "완료";
    case "FAILED":
      return "실패";
    case "CANCELED":
      return "취소";
    default:
      return status;
  }
}

function inviteStateLabel(state: InviteItem["state"]): string {
  switch (state) {
    case "ACTIVE":
      return "사용 가능";
    case "USED":
      return "사용 완료";
    case "EXPIRED":
      return "만료됨";
    default:
      return state;
  }
}

function accountStatusLabel(status: "CONNECTED" | "NEEDS_REAUTH" | "ERROR"): string {
  switch (status) {
    case "CONNECTED":
      return "정상";
    case "NEEDS_REAUTH":
      return "재인증 필요";
    case "ERROR":
      return "오류";
    default:
      return String(status);
  }
}

function courseStatusLabel(status: CourseItem["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "진행 중";
    case "UPCOMING":
      return "예정";
    case "ENDED":
      return "종료";
    default:
      return status;
  }
}

function compactErrorText(error: string | null): string {
  if (!error) return "-";

  if (error.includes("Transaction API error: Transaction not found")) {
    return "동기화 저장 중 DB 연결이 끊어졌습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (error.length <= 140) return error;
  return `${error.slice(0, 140)}...`;
}

export function DashboardClient({ initialUser }: DashboardClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [account, setAccount] = useState<Cu12AccountResponse["account"]>(null);

  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [inviteCu12Id, setInviteCu12Id] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "USER">("USER");
  const [inviteExpiresHours, setInviteExpiresHours] = useState(72);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [latestInviteToken, setLatestInviteToken] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<"SYNC" | "AUTOLEARN" | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState<"SYNC" | "AUTOLEARN" | null>(null);

  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<JobItem["status"] | null>(null);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [jobs],
  );

  const sortedInvites = useMemo(
    () =>
      [...invites].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [invites],
  );

  const syncInProgress = useMemo(
    () =>
      sortedJobs.some(
        (job) =>
          (job.type === "SYNC" || job.type === "NOTICE_SCAN")
          && (job.status === "PENDING" || job.status === "RUNNING"),
      ),
    [sortedJobs],
  );

  const autoLearnInProgress = useMemo(
    () =>
      sortedJobs.some(
        (job) =>
          job.type === "AUTOLEARN"
          && (job.status === "PENDING" || job.status === "RUNNING"),
      ),
    [sortedJobs],
  );

  const latestJob = sortedJobs[0] ?? null;

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    if (response.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }

    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "요청 처리에 실패했습니다.");
    }
    return payload;
  }, [router]);

  const refreshAll = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const [summaryRes, coursesRes, jobsRes, accountRes] = await Promise.all([
        fetchJson<DashboardSummary>("/api/dashboard/summary"),
        fetchJson<{ courses: CourseItem[] }>("/api/dashboard/courses"),
        fetchJson<{ jobs: JobItem[] }>("/api/jobs?limit=20"),
        fetchJson<Cu12AccountResponse>("/api/cu12/account"),
      ]);

      setSummary(summaryRes);
      setCourses(coursesRes.courses);
      setJobs(jobsRes.jobs);
      setAccount(accountRes.account);

      if (initialUser.role === "ADMIN") {
        const invitesRes = await fetchJson<{ invites: InviteItem[] }>(
          "/api/auth/invite",
        );
        setInvites(invitesRes.invites);
      }
    } catch (fetchError) {
      if ((fetchError as Error).message !== "Unauthorized") {
        setError((fetchError as Error).message);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [fetchJson, initialUser.role]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!trackingJobId) {
      return;
    }

    let stopped = false;

    const poll = async () => {
      if (stopped) return;

      try {
        const response = await fetch(`/api/jobs/${trackingJobId}`);
        if (response.status === 401) {
          router.push("/login" as Route);
          return;
        }

        const payload = (await response.json()) as JobDetailResponse & { error?: string };
        if (!response.ok) {
          setError(payload.error ?? "작업 상태를 확인하지 못했습니다.");
          setTrackingJobId(null);
          setTrackingStatus(null);
          return;
        }

        setTrackingStatus(payload.status);

        if (TERMINAL_JOB_STATUS.has(payload.status)) {
          setTrackingJobId(null);
          setTrackingStatus(null);
          await refreshAll(true);
          return;
        }

        setTimeout(poll, 3000);
      } catch {
        setTimeout(poll, 4000);
      }
    };

    void poll();

    return () => {
      stopped = true;
    };
  }, [trackingJobId, refreshAll, router]);

  async function runAction(action: "SYNC" | "AUTOLEARN") {
    setActionSubmitting(action);
    setConfirmAction(null);
    setError(null);
    setMessage(null);

    try {
      const endpoint = action === "SYNC" ? "/api/jobs/sync-now" : "/api/jobs/autolearn-request";
      const init: RequestInit = action === "SYNC"
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          };

      const payload = await fetchJson<JobDispatchResponse>(endpoint, init);
      setTrackingJobId(payload.jobId);
      setTrackingStatus(payload.status);

      const fallbackNotice = payload.deduplicated
        ? "이미 진행 중인 작업이 있어 기존 작업 상태를 보여드립니다."
        : "작업 요청이 큐에 등록되었습니다.";

      const dispatchTail = payload.dispatched
        ? ""
        : " 워커 호출은 지연 중이며, 큐에서 순서대로 처리됩니다.";

      setMessage(`${payload.notice ?? fallbackNotice}${dispatchTail}`);
      await refreshAll(true);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setActionSubmitting(null);
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingInvite(true);
    setError(null);
    setMessage(null);
    setLatestInviteToken(null);

    try {
      const payload = await fetchJson<{
        inviteId: string;
        token: string;
        expiresAt: string;
      }>("/api/auth/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id: inviteCu12Id,
          role: inviteRole,
          expiresHours: inviteExpiresHours,
        }),
      });

      setLatestInviteToken(payload.token);
      setMessage(`초대코드가 발급되었습니다. 만료 시각: ${toDateTime(payload.expiresAt)}`);
      setInviteCu12Id("");
      await refreshAll(true);
    } catch (inviteError) {
      setError((inviteError as Error).message);
    } finally {
      setCreatingInvite(false);
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
          <p className="brand-kicker">가톨릭 공유대</p>
          <h1>수강 현황 대시보드</h1>
          <p className="muted">
            {initialUser.email} ({initialUser.role})
          </p>
        </div>
        <button onClick={logout}>로그아웃</button>
      </header>

      {loading ? <p>데이터를 불러오는 중입니다...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="card">
        <h2>처음 사용 가이드</h2>
        <ol className="guide-list">
          <li>먼저 <strong>즉시 동기화</strong>를 눌러 최신 강좌/공지 상태를 가져옵니다.</li>
          <li>강좌 목록과 최근 작업 상태에서 결과를 확인합니다.</li>
          <li>필요할 때 <strong>자동 수강 요청</strong>을 눌러 작업을 등록합니다.</li>
        </ol>
        <p className="muted">동일 버튼을 여러 번 눌러도 중복 작업은 자동으로 합쳐집니다.</p>
      </section>

      <section className="grid-4">
        <article className="card">
          <h2>진행 강좌</h2>
          <p className="metric">{summary?.activeCourseCount ?? 0}</p>
        </article>
        <article className="card">
          <h2>평균 진도율</h2>
          <p className="metric">{Math.round(summary?.avgProgress ?? 0)}%</p>
        </article>
        <article className="card">
          <h2>미확인 공지</h2>
          <p className="metric">{summary?.unreadNoticeCount ?? 0}</p>
        </article>
        <article className="card">
          <h2>대기 학습항목</h2>
          <p className="metric">{summary?.upcomingDeadlines ?? 0}</p>
        </article>
      </section>

      <section className="card">
        <h2>최근 작업 상태</h2>
        {trackingJobId ? (
          <p>
            추적 중 작업: <code>{trackingJobId}</code>{" "}
            <span className={`status-chip status-${(trackingStatus ?? "PENDING").toLowerCase()}`}>
              {jobStatusLabel(trackingStatus ?? "PENDING")}
            </span>
          </p>
        ) : latestJob ? (
          <p>
            최근 작업: {jobTypeLabel(latestJob.type)} /{" "}
            <span className={`status-chip status-${latestJob.status.toLowerCase()}`}>
              {jobStatusLabel(latestJob.status)}
            </span>
          </p>
        ) : (
          <p className="muted">아직 실행된 작업이 없습니다.</p>
        )}
      </section>

      <section className="card">
        <h2>빠른 작업</h2>
        <div className="button-row">
          <button
            onClick={() => setConfirmAction("SYNC")}
            disabled={Boolean(actionSubmitting) || syncInProgress}
          >
            {actionSubmitting === "SYNC"
              ? "동기화 요청 중..."
              : syncInProgress
                ? "동기화 진행 중"
                : "즉시 동기화"}
          </button>
          <button
            onClick={() => setConfirmAction("AUTOLEARN")}
            disabled={Boolean(actionSubmitting) || autoLearnInProgress}
          >
            {actionSubmitting === "AUTOLEARN"
              ? "자동 수강 요청 중..."
              : autoLearnInProgress
                ? "자동 수강 진행 중"
                : "자동 수강 요청"}
          </button>
          <button
            className="ghost-btn"
            onClick={() => void refreshAll(true)}
            disabled={Boolean(actionSubmitting) || loading}
          >
            새로고침
          </button>
        </div>
        <p className="muted">
          마지막 동기화: {toDateTime(summary?.lastSyncAt ?? null)}
        </p>
        <p className="muted">
          동기화는 수십 초~수분, 자동 수강은 실제 학습 시간만큼 오래 걸릴 수 있습니다.
        </p>
      </section>

      <section className="card">
        <h2>연결 계정 정보</h2>
        {account ? (
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th>CU12 아이디</th>
                  <td>{account.cu12Id}</td>
                </tr>
                <tr>
                  <th>캠퍼스</th>
                  <td>{account.campus}</td>
                </tr>
                <tr>
                  <th>계정 상태</th>
                  <td>
                    {accountStatusLabel(account.accountStatus)}
                    {account.statusReason ? ` / ${account.statusReason}` : ""}
                  </td>
                </tr>
                <tr>
                  <th>자동 수강</th>
                  <td>{account.autoLearnEnabled ? "ON" : "OFF"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">연결된 계정 정보가 없습니다. 관리자에게 문의해 주세요.</p>
        )}
      </section>

      {initialUser.role === "ADMIN" ? (
        <section className="card">
          <h2>초대코드 관리 (관리자)</h2>
          <form onSubmit={createInvite} className="form-grid">
            <label className="field">
              <span>대상 CU12 아이디</span>
              <input
                value={inviteCu12Id}
                onChange={(event) => setInviteCu12Id(event.target.value)}
                required
                minLength={4}
              />
            </label>
            <label className="field">
              <span>권한</span>
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as "ADMIN" | "USER")
                }
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <label className="field">
              <span>유효 시간(시간)</span>
              <input
                type="number"
                min={1}
                max={720}
                value={inviteExpiresHours}
                onChange={(event) =>
                  setInviteExpiresHours(Number(event.target.value))
                }
                required
              />
            </label>
            <div className="field align-end">
              <button type="submit" disabled={creatingInvite}>
                {creatingInvite ? "발급 중..." : "초대코드 발급"}
              </button>
            </div>
          </form>

          {latestInviteToken ? (
            <p className="ok-text">
              발급된 초대코드: <code>{latestInviteToken}</code>
            </p>
          ) : null}

          <p className="muted">
            이미 가입 완료된 사용자는 초대코드 만료 여부와 무관합니다.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CU12 ID</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>생성 시각</th>
                  <th>만료 시각</th>
                  <th>사용 시각</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvites.length === 0 ? (
                  <tr>
                    <td colSpan={6}>발급된 초대코드가 없습니다.</td>
                  </tr>
                ) : (
                  sortedInvites.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.cu12Id}</td>
                      <td>{invite.role}</td>
                      <td>
                        <span className={`status-chip status-${invite.state.toLowerCase()}`}>
                          {inviteStateLabel(invite.state)}
                        </span>
                      </td>
                      <td>{toDateTime(invite.createdAt)}</td>
                      <td>{invite.state === "USED" ? "-" : toDateTime(invite.expiresAt)}</td>
                      <td>{toDateTime(invite.usedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>현재 수강 목록</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>강좌명</th>
                <th>담당 교수</th>
                <th>진도율</th>
                <th>남은 기간</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={5}>강좌 데이터가 없습니다.</td>
                </tr>
              ) : (
                courses.map((course) => (
                  <tr key={course.lectureSeq}>
                    <td>{course.title}</td>
                    <td>{course.instructor ?? "-"}</td>
                    <td>{course.progressPercent}%</td>
                    <td>{course.remainDays ?? "-"}</td>
                    <td>{courseStatusLabel(course.status)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>최근 작업 이력</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>생성 시각</th>
                <th>유형</th>
                <th>상태</th>
                <th>시도 횟수</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>작업 이력이 없습니다.</td>
                </tr>
              ) : (
                sortedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{toDateTime(job.createdAt)}</td>
                    <td>{jobTypeLabel(job.type)}</td>
                    <td>
                      <span className={`status-chip status-${job.status.toLowerCase()}`}>
                        {jobStatusLabel(job.status)}
                      </span>
                    </td>
                    <td>{job.attempts}</td>
                    <td>{compactErrorText(job.lastError)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {confirmAction ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            if (!actionSubmitting) {
              setConfirmAction(null);
            }
          }}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="작업 요청 확인"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{confirmAction === "SYNC" ? "즉시 동기화 실행" : "자동 수강 요청"}</h2>
            <p className="muted">
              {confirmAction === "SYNC"
                ? "즉시 동기화를 실행하면 최신 수강/공지 데이터를 다시 수집합니다."
                : "자동 수강은 영상 길이만큼 시간이 걸릴 수 있으며 큐에서 순차 처리됩니다."}
            </p>
            <div className="button-row">
              <button
                onClick={() => void runAction(confirmAction!)}
                disabled={Boolean(actionSubmitting)}
              >
                실행하기
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setConfirmAction(null)}
                disabled={Boolean(actionSubmitting)}
              >
                취소
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
