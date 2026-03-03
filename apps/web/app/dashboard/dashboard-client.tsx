"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [jobs],
  );

  const sortedInvites = useMemo(
    () =>
      [...invites].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [invites],
  );

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (response.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }

    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "요청 실패");
    }
    return payload;
  }

  async function refreshAll() {
    setLoading(true);
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
        const invitesRes = await fetchJson<{ invites: InviteItem[] }>("/api/auth/invite");
        setInvites(invitesRes.invites);
      }
    } catch (fetchError) {
      if ((fetchError as Error).message !== "Unauthorized") {
        setError((fetchError as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitSyncNow() {
    setMessage(null);
    setError(null);
    try {
      const payload = await fetchJson<{
        jobId: string;
        dispatched: boolean;
        dispatchError?: string;
      }>("/api/jobs/sync-now", { method: "POST" });
      setMessage(
        payload.dispatched
          ? `즉시 동기화 요청 완료: ${payload.jobId}`
          : `작업 등록 완료(디스패치 대기): ${payload.jobId} / ${payload.dispatchError ?? "unknown"}`,
      );
      await refreshAll();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  }

  async function submitAutoLearn() {
    setMessage(null);
    setError(null);
    try {
      const payload = await fetchJson<{
        jobId: string;
        dispatched: boolean;
        dispatchError?: string;
      }>("/api/jobs/autolearn-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      setMessage(
        payload.dispatched
          ? `자동 수강 요청 완료: ${payload.jobId}`
          : `작업 등록 완료(디스패치 대기): ${payload.jobId} / ${payload.dispatchError ?? "unknown"}`,
      );
      await refreshAll();
    } catch (submitError) {
      setError((submitError as Error).message);
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
      setMessage(`초대코드를 발급했습니다. 만료: ${new Date(payload.expiresAt).toLocaleString("ko-KR")}`);
      setInviteCu12Id("");
      await refreshAll();
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
      <header className="page-header">
        <div>
          <h1>가톨릭 공유대 자동화 대시보드</h1>
          <p className="muted">
            {initialUser.email} ({initialUser.role})
          </p>
        </div>
        <button onClick={logout}>로그아웃</button>
      </header>

      {loading ? <p>데이터를 불러오는 중...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

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
          <h2>대기 태스크</h2>
          <p className="metric">{summary?.upcomingDeadlines ?? 0}</p>
        </article>
      </section>

      <section className="card">
        <h2>빠른 작업</h2>
        <div className="button-row">
          <button onClick={submitSyncNow}>즉시 동기화</button>
          <button onClick={submitAutoLearn}>자동 수강 요청</button>
          <button onClick={() => void refreshAll()}>새로고침</button>
        </div>
        <p className="muted">
          마지막 동기화: {summary?.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString("ko-KR") : "없음"}
        </p>
      </section>

      <section className="card">
        <h2>연결된 CU12 계정</h2>
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
                  <th>상태</th>
                  <td>
                    {account.accountStatus}
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
          <p className="muted">현재 로그인된 CU12 계정 정보가 없습니다.</p>
        )}
      </section>

      {initialUser.role === "ADMIN" ? (
        <section className="card">
          <h2>초대코드 관리 (관리자)</h2>
          <form onSubmit={createInvite} className="form-grid">
            <label className="field">
              <span>CU12 아이디</span>
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
                onChange={(event) => setInviteRole(event.target.value as "ADMIN" | "USER")}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <label className="field">
              <span>유효 시간 (시간)</span>
              <input
                type="number"
                min={1}
                max={720}
                value={inviteExpiresHours}
                onChange={(event) => setInviteExpiresHours(Number(event.target.value))}
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
              새 초대코드: <code>{latestInviteToken}</code>
            </p>
          ) : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CU12 ID</th>
                  <th>권한</th>
                  <th>생성일</th>
                  <th>만료일</th>
                  <th>사용일</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvites.length === 0 ? (
                  <tr>
                    <td colSpan={5}>초대코드 없음</td>
                  </tr>
                ) : (
                  sortedInvites.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.cu12Id}</td>
                      <td>{invite.role}</td>
                      <td>{new Date(invite.createdAt).toLocaleString("ko-KR")}</td>
                      <td>{new Date(invite.expiresAt).toLocaleString("ko-KR")}</td>
                      <td>{invite.usedAt ? new Date(invite.usedAt).toLocaleString("ko-KR") : "-"}</td>
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
                <th>강좌</th>
                <th>강사</th>
                <th>진도율</th>
                <th>남은일</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={5}>데이터 없음</td>
                </tr>
              ) : (
                courses.map((course) => (
                  <tr key={course.lectureSeq}>
                    <td>{course.title}</td>
                    <td>{course.instructor ?? "-"}</td>
                    <td>{course.progressPercent}%</td>
                    <td>{course.remainDays ?? "-"}</td>
                    <td>{course.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>최근 작업</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>생성시각</th>
                <th>타입</th>
                <th>상태</th>
                <th>시도</th>
                <th>오류</th>
              </tr>
            </thead>
            <tbody>
              {sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>작업 없음</td>
                </tr>
              ) : (
                sortedJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{new Date(job.createdAt).toLocaleString("ko-KR")}</td>
                    <td>{job.type}</td>
                    <td>{job.status}</td>
                    <td>{job.attempts}</td>
                    <td>{job.lastError ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
