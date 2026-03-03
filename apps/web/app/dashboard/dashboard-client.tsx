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
  startedAt: string | null;
  finishedAt: string | null;
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

export function DashboardClient({ initialUser }: DashboardClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [account, setAccount] = useState<Cu12AccountResponse["account"]>(null);

  const [cu12Id, setCu12Id] = useState("");
  const [cu12Password, setCu12Password] = useState("");
  const [campus, setCampus] = useState<"SONGSIM" | "SONGSIN">("SONGSIM");
  const [savingAccount, setSavingAccount] = useState(false);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [jobs],
  );

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (response.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error((payload as { error?: string }).error ?? "요청 실패");
    }
    return payload;
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);

    try {
      const [summaryRes, coursesRes, jobsRes, accountRes] = await Promise.all([
        fetchJson<{ activeCourseCount: number; avgProgress: number; unreadNoticeCount: number; upcomingDeadlines: number; lastSyncAt: string | null }>("/api/dashboard/summary"),
        fetchJson<{ courses: CourseItem[] }>("/api/dashboard/courses"),
        fetchJson<{ jobs: JobItem[] }>("/api/jobs?limit=20"),
        fetchJson<Cu12AccountResponse>("/api/cu12/account"),
      ]);

      setSummary(summaryRes);
      setCourses(coursesRes.courses);
      setJobs(jobsRes.jobs);
      setAccount(accountRes.account);

      if (accountRes.account) {
        setCu12Id(accountRes.account.cu12Id);
        setCampus(accountRes.account.campus);
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
        status: string;
        dispatched: boolean;
        dispatchError?: string;
      }>("/api/jobs/sync-now", { method: "POST" });
      setMessage(
        payload.dispatched
          ? `동기화 요청 완료: ${payload.jobId}`
          : `큐 등록 완료(디스패치 대기): ${payload.jobId} / ${payload.dispatchError ?? "unknown"}`,
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
        status: string;
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
          : `큐 등록 완료(디스패치 대기): ${payload.jobId} / ${payload.dispatchError ?? "unknown"}`,
      );
      await refreshAll();
    } catch (submitError) {
      setError((submitError as Error).message);
    }
  }

  async function saveCu12Account(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAccount(true);
    setMessage(null);
    setError(null);

    try {
      await fetchJson<{
        connected: boolean;
        queuedJobId: string;
        dispatched: boolean;
        dispatchError?: string;
      }>("/api/cu12/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cu12Id,
          cu12Password,
          campus,
        }),
      });
      setCu12Password("");
      setMessage("CU12 계정이 저장되었고 즉시 동기화가 큐에 등록되었습니다.");
      await refreshAll();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingAccount(false);
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
          <h1>CU12 대시보드</h1>
          <p className="muted">
            {initialUser.email} ({initialUser.role})
          </p>
        </div>
        <button onClick={logout}>로그아웃</button>
      </header>

      {loading ? <p>불러오는 중...</p> : null}
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
          마지막 동기화:{" "}
          {summary?.lastSyncAt
            ? new Date(summary.lastSyncAt).toLocaleString("ko-KR")
            : "없음"}
        </p>
      </section>

      <section className="card">
        <h2>CU12 계정 연동</h2>
        <p className="muted">
          상태: {account?.accountStatus ?? "NOT_CONNECTED"}
          {account?.statusReason ? ` / ${account.statusReason}` : ""}
        </p>
        <form onSubmit={saveCu12Account} className="form-grid">
          <label className="field">
            <span>CU12 아이디</span>
            <input
              value={cu12Id}
              onChange={(event) => setCu12Id(event.target.value)}
              required
              minLength={4}
            />
          </label>
          <label className="field">
            <span>CU12 비밀번호</span>
            <input
              type="password"
              value={cu12Password}
              onChange={(event) => setCu12Password(event.target.value)}
              required
              minLength={4}
            />
          </label>
          <label className="field">
            <span>캠퍼스</span>
            <select
              value={campus}
              onChange={(event) =>
                setCampus(event.target.value as "SONGSIM" | "SONGSIN")
              }
            >
              <option value="SONGSIM">SONGSIM</option>
              <option value="SONGSIN">SONGSIN</option>
            </select>
          </label>
          <div className="field align-end">
            <button type="submit" disabled={savingAccount}>
              {savingAccount ? "저장 중..." : "계정 저장"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>현재 수강 목록</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>강좌</th>
                <th>강사</th>
                <th>진도율</th>
                <th>잔여일</th>
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
