"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

interface DashboardClientProps {
  initialUser: {
    email: string;
    role: "ADMIN" | "USER";
  };
}

interface SessionContext {
  actor: { userId: string; email: string; role: "ADMIN" | "USER" };
  effective: { userId: string; email: string; role: "ADMIN" | "USER" };
  impersonating: boolean;
}

interface Summary {
  activeCourseCount: number;
  avgProgress: number;
  unreadNoticeCount: number;
  urgentTaskCount: number;
  nextDeadlineAt: string | null;
  lastSyncAt: string | null;
  initialSyncRequired: boolean;
}

interface Course {
  lectureSeq: number;
  title: string;
  instructor: string | null;
  progressPercent: number;
  pendingTaskCount: number;
  currentWeekNo: number | null;
  nextPendingTask: { weekNo: number; lessonNo: number; dueAt: string | null } | null;
}

interface Deadline {
  lectureSeq: number;
  courseContentsSeq: number;
  weekNo: number;
  lessonNo: number;
  courseTitle: string;
  availableFrom: string | null;
  dueAt: string | null;
  remainingSeconds: number;
  daysLeft: number | null;
}

interface Notice {
  id: string;
  title: string;
  author: string | null;
  postedAt: string | null;
  bodyText: string;
  isRead: boolean;
}

interface Notification {
  id: string;
  courseTitle: string;
  message: string;
  occurredAt: string | null;
  createdAt: string;
  isUnread: boolean;
}

interface Job {
  id: string;
  type: "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  createdAt: string;
  result?: unknown;
}

interface JobDispatch {
  jobId: string;
  deduplicated: boolean;
  notice?: string;
}

interface JobDetail {
  status: Job["status"];
  result?: unknown;
}

interface MailPreference {
  email: string;
  enabled: boolean;
  alertOnNotice: boolean;
  alertOnDeadline: boolean;
  alertOnAutolearn: boolean;
  digestEnabled: boolean;
  digestHour: number;
  updatedAt: string | null;
}

interface Account {
  cu12Id: string;
  campus: "SONGSIM" | "SONGSIN";
  accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR";
  statusReason: string | null;
}

interface AutoProgress {
  kind: "AUTOLEARN_PROGRESS";
  progress: {
    totalTasks: number;
    completedTasks: number;
    watchedSeconds: number;
    estimatedRemainingSeconds: number;
  };
}

const TERMINAL = new Set<Job["status"]>(["SUCCEEDED", "FAILED", "CANCELED"]);
const POLL_ACTIVE_MS = 120000;
const POLL_IDLE_MS = 300000;
const POLL_IDLE_THRESHOLD_MS = 5 * 60 * 1000;

interface DashboardBootstrap {
  context: SessionContext;
  summary: Summary;
  courses: Course[];
  deadlines: Deadline[];
  notifications: Notification[];
  jobs: Job[];
  account: Account | null;
  preference: MailPreference;
}

function toDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("ko-KR") : "-";
}

function formatSeconds(value: number): string {
  const sec = Math.max(0, Math.floor(value));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDays(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  return `D-${days}`;
}

}

function parseAutoProgress(value: unknown): AutoProgress | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as Partial<AutoProgress>;
  if (maybe.kind !== "AUTOLEARN_PROGRESS" || !maybe.progress) return null;
  return maybe as AutoProgress;
}

export function DashboardClient({ initialUser }: DashboardClientProps) {
  const router = useRouter();
  const bootstrapRef = useRef(false);
  const lastInteractionAtRef = useRef(Date.now());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockingMessage, setBlockingMessage] = useState<string | null>("?????????? ???곗뵯??????紐꾪닓 嚥싳쉶瑗??꾧틡??????딅젩...");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [context, setContext] = useState<SessionContext | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mailDraft, setMailDraft] = useState<MailPreference | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const [mode, setMode] = useState<"SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES">("ALL_COURSES");
  const [lectureSeq, setLectureSeq] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"SYNC" | "AUTOLEARN" | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMailSetupRequired, setIsMailSetupRequired] = useState(false);

  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);
  const [trackingDetail, setTrackingDetail] = useState<JobDetail | null>(null);
  const [bootstrapSyncing, setBootstrapSyncing] = useState(false);
  const [cancelSubmittingJobId, setCancelSubmittingJobId] = useState<string | null>(null);

  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeCourse, setNoticeCourse] = useState<Course | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activeNotice, setActiveNotice] = useState<Notice | null>(null);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jobs],
  );
  const syncInProgress = sortedJobs.some((job) => (job.type === "SYNC" || job.type === "NOTICE_SCAN") && (job.status === "PENDING" || job.status === "RUNNING"));
  const autoInProgress = sortedJobs.some((job) => job.type === "AUTOLEARN" && (job.status === "PENDING" || job.status === "RUNNING"));
  const unreadNotifications = notifications.filter((item) => item.isUnread);
  const autoProgress = parseAutoProgress(trackingDetail?.result);
  const trackingCanCancel = trackingDetail?.status === "RUNNING" || trackingDetail?.status === "PENDING";
  const isJobCancellable = (status: Job["status"]) => status === "RUNNING" || status === "PENDING";
  const isCanceling = (jobId: string) => cancelSubmittingJobId === jobId;

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);
    if (res.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }
    const payload = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "???됰Ŋ????????곌숯");
    return payload;
  }, [router]);

  const refreshAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else {
      setLoading(true);
      if (!bootstrapSyncing) {
        setBlockingMessage("?????????? ???곗뵯??????紐꾪닓 嚥싳쉶瑗??꾧틡??????딅젩...");
      }
    }
    setError(null);

    try {
      const payload = await fetchJson<DashboardBootstrap>("/api/dashboard/bootstrap?deadlinesLimit=20&notificationsLimit=40&jobsLimit=20");
      setContext(payload.context);
      setSummary(payload.summary);
      setCourses(payload.courses);
      setDeadlines(payload.deadlines);
      setNotifications(payload.notifications);
      setJobs(payload.jobs);
      if (!trackingJobId) {
        const activeJob = payload.jobs.find((item) => item.status === "PENDING" || item.status === "RUNNING");
        if (activeJob) setTrackingJobId(activeJob.id);
      }
      setAccount(payload.account);
      setMailDraft(payload.preference);
      const requiresMailSetup = payload.preference.updatedAt === null;
      setIsMailSetupRequired(requiresMailSetup);
      if (requiresMailSetup) {
        setSettingsOpen(true);
      }
      if (!lectureSeq && payload.courses.length > 0) setLectureSeq(payload.courses[0].lectureSeq);
    } catch (err) {
      if ((err as Error).message !== "Unauthorized") setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      if (!bootstrapSyncing) setBlockingMessage(null);
    }
  }, [fetchJson, lectureSeq, bootstrapSyncing, trackingJobId]);

  useEffect(() => {
    void refreshAll(false);
  }, [refreshAll]);

  useEffect(() => {
    const touch = () => {
      lastInteractionAtRef.current = Date.now();
    };

    const interactionEvents: Array<keyof DocumentEventMap> = ["mousemove", "mousedown", "keydown", "touchstart"];
    interactionEvents.forEach((eventName) => document.addEventListener(eventName, touch, { passive: true }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      const idleMs = Date.now() - lastInteractionAtRef.current;
      const nextMs = document.hidden || idleMs >= POLL_IDLE_THRESHOLD_MS ? POLL_IDLE_MS : POLL_ACTIVE_MS;
      timeoutId = setTimeout(() => {
        if (!document.hidden) {
          void refreshAll(true);
        }
        scheduleNext();
      }, nextMs);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        touch();
        void refreshAll(true);
      }
    };

    scheduleNext();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      interactionEvents.forEach((eventName) => document.removeEventListener(eventName, touch));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!summary || loading) return;
    if (summary.initialSyncRequired && !syncInProgress && !bootstrapRef.current) {
      bootstrapRef.current = true;
      setBootstrapSyncing(true);
      setBlockingMessage("?꿔꺂????쭍???????ロ꺙??? ?꿔꺂????紐꾩뗄?嚥싳쉶瑗??꾧틡??????딅젩.");
      void runAction("SYNC", true);
    }
  }, [summary, loading, syncInProgress]);

  useEffect(() => {
    if (!trackingJobId) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const detail = await fetchJson<JobDetail>(`/api/jobs/${trackingJobId}`);
        setTrackingDetail(detail);
        if (TERMINAL.has(detail.status)) {
          setTrackingJobId(null);
          setBootstrapSyncing(false);
          setBlockingMessage(null);
          await refreshAll(true);
          return;
        }
      } catch {}
      setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; };
  }, [trackingJobId, fetchJson, refreshAll]);

  async function runAction(action: "SYNC" | "AUTOLEARN", silent = false) {
    setActionSubmitting(true);
    setConfirm(null);
    if (!silent) setBlockingMessage(action === "SYNC" ? "?????ロ꺙?????됰Ŋ????꿔꺂??節뉖き??嚥?.." : "???嶺??????븍뼃 ???됰Ŋ????꿔꺂??節뉖き??嚥?..");
    try {
      if (action === "AUTOLEARN" && mode !== "ALL_COURSES" && !lectureSeq) throw new Error("??醫딆┫?뺢껴堉?釉앹췀??ｊ괴?????ｋ??????녿뮝???ル튉??");
      const payload = await fetchJson<JobDispatch>(
        action === "SYNC" ? "/api/jobs/sync-now" : "/api/jobs/autolearn-request",
        action === "SYNC"
          ? { method: "POST" }
          : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode, lectureSeq: mode === "ALL_COURSES" ? undefined : lectureSeq }),
          },
      );
      setTrackingJobId(payload.jobId);
      setMessage(payload.notice ?? (payload.deduplicated ? "???? ?꿔꺂????紐꾩뗄?嚥싳쉶瑗??꾧틡???????????????????딅젩." : "???됰Ŋ???????????????????딅젩."));
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message);
      setBootstrapSyncing(false);
    } finally {
      setActionSubmitting(false);
      if (!bootstrapSyncing) setBlockingMessage(null);
    }
  }
  async function cancelJobById(jobId: string, status?: Job["status"]) {
    if (!jobId || isCanceling(jobId)) return;
    const targetStatus = trackingJobId === jobId ? trackingDetail?.status ?? status : status;
    if (!isJobCancellable(targetStatus ?? "SUCCEEDED")) return;

    setCancelSubmittingJobId(jobId);
    setBlockingMessage("?묒뾽 以묐떒 ?붿껌 以?..");
    try {
      const payload = await fetchJson<{ status: Job["status"]; updated: boolean }>(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      setMessage(payload.updated ? "?묒뾽 以묐떒 ?붿껌?덉뒿?덈떎." : `?꾩옱 ?곹깭: ${payload.status}`);
      setTrackingJobId(jobId);
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelSubmittingJobId((current) => (current === jobId ? null : current));
      if (!bootstrapSyncing) {
        setBlockingMessage(null);
      }
    }
  }

  async function cancelTrackingJob() {
    if (!trackingJobId || !trackingCanCancel) return;
    await cancelJobById(trackingJobId, trackingDetail?.status);
  }

  async function markNotificationRead(item: Notification) {
    setActiveNotification(item);
    if (!item.isUnread) return;
    await fetchJson(`/api/dashboard/notifications/${item.id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((row) => (row.id === item.id ? { ...row, isUnread: false } : row)));
  }

  async function openNotices(course: Course) {
    setNoticeModalOpen(true);
    setNoticeCourse(course);
    setNoticeLoading(true);
    const payload = await fetchJson<{ notices: Notice[] }>(`/api/dashboard/courses/${course.lectureSeq}/notices`);
    setNotices(payload.notices);
    setActiveNotice(payload.notices[0] ?? null);
    setNoticeLoading(false);
  }

  async function markNoticeRead(noticeId: string) {
    await fetchJson(`/api/dashboard/notices/${noticeId}/read`, { method: "PATCH" });
    setNotices((prev) => prev.map((item) => (item.id === noticeId ? { ...item, isRead: true } : item)));
  }

  async function saveMail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mailDraft) return;
    setMailSaving(true);
    setBlockingMessage("?꿔꺂????????繹먮냱??????嚥?..");
    try {
      await fetchJson("/api/mail/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mailDraft),
      });
      setIsMailSetupRequired(false);
      setSettingsOpen(false);
      setMessage("?꿔꺂????????繹먮냱??????嚥싳쇎維끻퐲??????");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMailSaving(false);
      setBlockingMessage(null);
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
          <p className="brand-kicker">??醫딆쓧?????????????용맪??????댁벖??????/p>
          <h1>????볥궙??????? ??/h1>
          <p className="muted">{context?.effective.email ?? initialUser.email}</p>
          {context?.impersonating ? <p className="error-text">???援온??잙갭큔????????????덊떀 ?꿔꺂??袁ㅻ븶???/p> : null}
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => void refreshAll(false)} disabled={loading || refreshing}>????沅???쒙쭫??/button>
          {initialUser.role === "ADMIN" ? (
            <button className="ghost-btn" onClick={() => router.push("/admin" as Route)}>???援온??잙갭큔????꿔꺂??????/button>
          ) : null}
          <button className="ghost-btn" onClick={() => setSettingsOpen(true)}>???繹먮냱??/button>
          <button onClick={logout}>?汝??吏?????썹땟??/button>
        </div>
      </header>

      {refreshing ? <p className="muted">???嶺???醫딆┣???嚥?..</p> : null}

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="grid-4">
        <article className="card"><h2>?꿔꺂????紐꾩뗄???醫딆┫?뺢껴堉??/h2><p className="metric">{summary?.activeCourseCount ?? 0}</p></article>
        <article className="card"><h2>??????꿔꺂???????/h2><p className="metric">{Math.round(summary?.avgProgress ?? 0)}%</p></article>
        <article className="card"><h2>???붺몭?겹럷???????댁벖?</h2><p className="metric">{summary?.unreadNoticeCount ?? 0}</p></article>
        <article className="card"><h2>????썹땟怨살춾??꿔꺂?볟젆怨곷븶??/h2><p className="metric">{summary?.urgentTaskCount ?? 0}</p></article>
      </section>

      <section className="card">
        <h2>???嶺??????븍뼃</h2>
        <div className="button-row">
          <button onClick={() => setConfirm("SYNC")} disabled={actionSubmitting || syncInProgress}>{syncInProgress ? "?????ロ꺙???꿔꺂????紐꾩뗄?嚥? : "?꿔꺂?ｉ뜮戮녹춹???????ロ꺙??}</button>
          <button onClick={() => setConfirm("AUTOLEARN")} disabled={actionSubmitting || autoInProgress}>{autoInProgress ? "???嶺??????븍뼃 ?꿔꺂????紐꾩뗄?嚥? : "???嶺??????븍뼃 ???됰Ŋ???}</button>
        </div>
        <div className="form-grid top-gap">
          <label className="field">
            <span>?꿔꺂??袁ㅻ븶???/span>
            <select value={mode} onChange={(event) => setMode(event.target.value as "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES")}>
              <option value="ALL_COURSES">????썹땟????醫딆┫?뺢껴堉??/option>
              <option value="SINGLE_ALL">????ｋ????醫딆┫?뺢껴堉??????썹땟??/option>
              <option value="SINGLE_NEXT">????ｋ????醫딆┫?뺢껴堉?????繹먮굞???꿔꺂?볟젆怨곷븶??/option>
            </select>
          </label>
          <label className="field">
            <span>??????醫딆┫?뺢껴堉??/span>
            <select value={lectureSeq ?? ""} onChange={(event) => setLectureSeq(Number(event.target.value))} disabled={mode === "ALL_COURSES"}>
              <option value="">??醫딆┫?뺢껴堉??????ｋ??/option>
              {courses.map((course) => <option key={course.lectureSeq} value={course.lectureSeq}>{course.title}</option>)}
            </select>
          </label>
        </div>
        {trackingDetail ? (
          <div className="form-stack top-gap">
            <p className="muted">
              ??????????븐뻤?? {trackingDetail.status}
              {autoProgress
                ? ` (${autoProgress.progress.completedTasks}/${autoProgress.progress.totalTasks}, ${formatSeconds(autoProgress.progress.estimatedRemainingSeconds)} ????묐┛?`
                : ""}
            </p>
          {trackingCanCancel ? (
            <div className="button-row">
              <button
                className="ghost-btn"
                style={{ borderColor: "rgb(180 35 24 / 45%)", color: "var(--danger)" }}
                onClick={() => void cancelTrackingJob()}
                disabled={isCanceling(trackingJobId)}
              >
                {isCanceling(trackingJobId) ? "??얜???繞벿살탮????븐슙??繞?.." : "??얜???嶺뚯빖留??繞벿살탮??}
              </button>
            </div>
          ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>?꿔꺂????용닽??????썹땟怨살춾??꿔꺂?볟젆怨곷븶??/h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>??醫딆┫?뺢껴堉??/th><th>???녿뮝???쀬씀??꿔꺂?볟젆怨곷븶??/th><th>??????癲ル슢????琉우?耀붾굝梨???굿?/th><th>??? ??????/th></tr></thead>
            <tbody>
              {deadlines.length === 0 ? <tr><td colSpan={4}>????썹땟怨살춾??꿔꺂?볟젆怨곷븶???醫롮?? ????ㅿ폍??????딅젩.</td></tr> : deadlines.map((item) => (
                <tr key={`${item.lectureSeq}:${item.courseContentsSeq}`}>
                  <td>{item.courseTitle}</td>
                  <td>{item.weekNo}???녿뮝???쀬씀?{item.lessonNo}?꿔꺂?볟젆怨곷븶??/td>
                  <td>{toDateTime(item.availableFrom)} ~ {toDateTime(item.dueAt)}</td>
                  <td>{formatDays(item.daysLeft)} / {formatSeconds(item.remainingSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>?臾믩씜 筌뤴뫖以?/h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>?ル굝履?/th><th>?怨밴묶</th><th>?遺욧퍕</th><th>?臾믩씜</th></tr></thead>
            <tbody>
              {sortedJobs.length === 0 ? <tr><td colSpan={4}>?臾믩씜????곷뮸??덈뼄.</td></tr> : sortedJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.type}</td>
                  <td>{job.status}</td>
                  <td>{toDateTime(job.createdAt)}</td>
                  <td>
                    {isJobCancellable(job.status) ? (
                      <button className="ghost-btn" onClick={() => void cancelJobById(job.id, job.status)} disabled={isCanceling(job.id)}>
                        {isCanceling(job.id) ? "?띯뫁???遺욧퍕 餓?.." : "?띯뫁??}
                      </button>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>???붺몭?겹럷????????/h2>
        <div className="notification-list">
          {unreadNotifications.length === 0 ? <p className="muted">????????????ㅿ폍??????딅젩.</p> : unreadNotifications.map((item) => (
            <button key={item.id} className="notification-item is-unread" onClick={() => void markNotificationRead(item)}>
              {item.courseTitle || "??嶺?筌??}
              <span className="muted">{item.message}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>??醫딆┫?뺢껴堉??????꾣뤃??/h2>
        <div className="course-grid">
          {courses.map((course) => (
            <article key={course.lectureSeq} className="course-card">
              <h3>{course.title}</h3>
              <p className="muted">??????????? {course.instructor ?? "-"}</p>
              <p>?꿔꺂???????<strong>{course.progressPercent}%</strong></p>
              <p className="muted">????썹땟?????녿뮝???쀬씀?{course.currentWeekNo ?? "-"} / ???붺몭?겹럷???類??{course.pendingTaskCount}??/p>
              <p className="muted">???繹먮굞???꿔꺂?볟젆怨곷븶???꿔꺂????용닽?? {toDateTime(course.nextPendingTask?.dueAt ?? null)}</p>
              <button className="ghost-btn" onClick={() => void openNotices(course)}>????댁벖? ??⑤슢?????/button>
            </article>
          ))}
        </div>
      </section>

      {confirm ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>{confirm === "SYNC" ? "?????ロ꺙???????덊떀" : "???嶺??????븍뼃 ?????덊떀"}</h2>
            <div className="button-row">
              <button onClick={() => void runAction(confirm)}>?????덊떀</button>
              <button className="ghost-btn" onClick={() => setConfirm(null)}>??????/button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-overlay">
          <section className="modal-card wide">
            <h2>????????繹먮냱??/h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr><th>CU12 ????썹땟?㈑??/th><td>{account?.cu12Id ?? "-"}</td></tr>
                  <tr><th>??辱???/th><td>{account?.campus ?? "-"}</td></tr>
                  <tr><th>??影??낟??????븐뻤??/th><td>{account?.accountStatus ?? "-"}{account?.statusReason ? ` / ${account.statusReason}` : ""}</td></tr>
                  <tr><th>?꿔꺂???????????ロ꺙??/th><td>{toDateTime(summary?.lastSyncAt ?? null)}</td></tr>
                  <tr><th>???繹먮굞???꿔꺂????용닽??/th><td>{toDateTime(summary?.nextDeadlineAt ?? null)}</td></tr>
                </tbody>
              </table>
            </div>
            {mailDraft ? (
              <form onSubmit={saveMail} className="form-stack top-gap">
                <label className="field"><span>??嶺뚮슣?쒎젆????癲??/span><input type="email" value={mailDraft.email} onChange={(event) => setMailDraft({ ...mailDraft, email: event.target.value })} required /></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.enabled} onChange={(event) => setMailDraft({ ...mailDraft, enabled: event.target.checked })} /><span>?꿔꺂??????????????/span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnNotice} onChange={(event) => setMailDraft({ ...mailDraft, alertOnNotice: event.target.checked })} /><span>????ャ렑??????댁벖?/??????꿔꺂?ｉ뜮戮녹춹???熬곣뫖利든뜏??/span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnDeadline} onChange={(event) => setMailDraft({ ...mailDraft, alertOnDeadline: event.target.checked })} /><span>?꿔꺂?볟젆怨곷븶???꿔꺂????용닽??????썹땟怨살춾??????/span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnAutolearn} onChange={(event) => setMailDraft({ ...mailDraft, alertOnAutolearn: event.target.checked })} /><span>???嶺??????븍뼃 ?嚥▲굧?????熬곣뫖利든뜏??/span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.digestEnabled} onChange={(event) => setMailDraft({ ...mailDraft, digestEnabled: event.target.checked })} /><span>??濚밸Ŧ??????됰Ŋ????꿔꺂?????/span></label>
                <label className="field"><span>???됰Ŋ?????????(0~23)</span><input type="number" min={0} max={23} value={mailDraft.digestHour} onChange={(event) => setMailDraft({ ...mailDraft, digestHour: Number(event.target.value) })} /></label>
                {isMailSetupRequired ? (
                  <p className="error-text" style={{ marginBottom: "4px" }}>
                    ?꿔꺂????쭍????????????????????딅젩. ?꿔꺂????????녿뮝???? ????????繹먮냱??????嚥싳쇎紐???????嶺뚮㉡????? ??影??낟???????????????????딅젩.
                  </p>
                ) : null}
                <div className="button-row">
                  <button type="submit" disabled={mailSaving}>{mailSaving ? "????嚥?.." : "????}</button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setSettingsOpen(false)}
                    disabled={mailSaving || isMailSetupRequired}
                  >
                    ???????
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        </div>
      ) : null}

      {noticeModalOpen ? (
        <div className="modal-overlay" onClick={() => setNoticeModalOpen(false)}>
          <section className="modal-card wide" onClick={(event) => event.stopPropagation()}>
            <h2>{noticeCourse?.title ?? "??醫딆┫?뺢껴堉??????댁벖?"}</h2>
            {noticeLoading ? <p className="muted">????댁벖? ?汝??吏??뮤?嚥?..</p> : null}
            <div className="notice-layout">
              <div className="notice-list">
                {notices.map((notice) => (
                  <button key={notice.id} className={`notification-item ${notice.isRead ? "" : "is-unread"}`} onClick={() => { setActiveNotice(notice); void markNoticeRead(notice.id); }}>
                    {notice.title}
                  </button>
                ))}
              </div>
              <article className="notice-detail">
                {activeNotice ? (
                  <>
                    <h3>{activeNotice.title}</h3>
                    <p className="muted">{toDateTime(activeNotice.postedAt)} ??{activeNotice.author ?? "??????????붺몭?겹럷?룔볂?}</p>
                    <pre>{activeNotice.bodyText || "??⑤슢?뽫춯??쒐뙴?????ㅼ굡??}</pre>
                  </>
                ) : <p className="muted">????댁벖???????ｋ??????녿뮝???ル튉??</p>}
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {activeNotification ? (
        <div className="modal-overlay" onClick={() => setActiveNotification(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{activeNotification.courseTitle || "??嶺?筌???????}</h2>
            <p className="muted">{toDateTime(activeNotification.occurredAt ?? activeNotification.createdAt)}</p>
            <p>{activeNotification.message}</p>
            <button className="ghost-btn" onClick={() => setActiveNotification(null)}>???????/button>
          </section>
        </div>
      ) : null}

      {blockingMessage ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>?꿔꺂??節뉖き??嚥?/h2>
            <p className="muted">{blockingMessage}</p>
            <div className="loading-bar"><span /></div>
          </section>
        </div>
      ) : null}
    </>
  );
}
