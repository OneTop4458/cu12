"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotificationCenter } from "../../components/notifications/notification-center";
import { RotateCw } from "lucide-react";
import { ThemeToggle } from "../../components/theme/theme-toggle";
import { UserMenu } from "../../components/layout/user-menu";

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

interface ActivityTypeCounts {
  VOD: number;
  QUIZ: number;
  ASSIGNMENT: number;
  ETC: number;
}

interface CourseWeekSummary {
  weekNo: number;
  totalTaskCount: number;
  completedTaskCount: number;
  pendingTaskCount: number;
  totalTaskTypeCounts: ActivityTypeCounts;
  pendingTaskTypeCounts: ActivityTypeCounts;
}

interface Course {
  lectureSeq: number;
  title: string;
  instructor: string | null;
  progressPercent: number;
  pendingTaskCount: number;
  completedTaskCount: number;
  totalTaskCount: number;
  currentWeekNo: number | null;
  totalRequiredSeconds: number;
  totalLearnedSeconds: number;
  taskTypeCounts: ActivityTypeCounts;
  pendingTaskTypeCounts: ActivityTypeCounts;
  weekSummaries: CourseWeekSummary[];
  noticeCount: number;
  unreadNoticeCount: number;
  nextPendingTask: { weekNo: number; lessonNo: number; dueAt: string | null; availableFrom: string | null } | null;
  deadlineLabel: string;
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

interface SiteNotice {
  id: string;
  title: string;
  message: string;
  type: "BROADCAST" | "MAINTENANCE";
  isActive: boolean;
  priority: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  createdAt: string;
  updatedAt: string;
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
  siteNotices: SiteNotice[];
  maintenanceNotice: SiteNotice | null;
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
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

function formatDays(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return "마감 지남";
  if (days === 0) return "오늘 마감";
  return `D-${days}`;
}

function parseAutoProgress(value: unknown): AutoProgress | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as Partial<AutoProgress>;
  if (maybe.kind !== "AUTOLEARN_PROGRESS" || !maybe.progress) return null;
  return maybe as AutoProgress;
}

function formatTaskCountsByType(counts: ActivityTypeCounts): string {
  return `영상 ${counts.VOD}개 / 과제 ${counts.ASSIGNMENT}개 / 시험 ${counts.QUIZ}개 / 기타 ${counts.ETC}개`;
}

function findCurrentWeekSummary(course: Course): CourseWeekSummary | null {
  if (course.currentWeekNo === null) return null;
  return course.weekSummaries.find((entry) => entry.weekNo === course.currentWeekNo) ?? null;
}

function formatCourseWeekProgress(course: Course): string {
  if (course.currentWeekNo === null) return "현재주차: -";
  const summary = findCurrentWeekSummary(course);
  if (!summary) {
    return `현재주차: ${course.currentWeekNo}주차`;
  }
  return `현재주차 ${course.currentWeekNo}주차: 총 ${summary.totalTaskCount}개, 완료 ${summary.completedTaskCount}개, 미완료 ${summary.pendingTaskCount}개`;
}

function formatPendingByType(summary: CourseWeekSummary | null): string {
  const target = summary ?? null;
  if (!target) return "미완료 항목 없음";
  const parts: string[] = [];
  if (target.pendingTaskCount === 0) return "이번 주차 미완료 없음";
  parts.push(`영상 ${target.pendingTaskTypeCounts.VOD}개`);
  parts.push(`과제 ${target.pendingTaskTypeCounts.ASSIGNMENT}개`);
  parts.push(`시험 ${target.pendingTaskTypeCounts.QUIZ}개`);
  parts.push(`기타 ${target.pendingTaskTypeCounts.ETC}개`);
  return parts.join(" / ");
}

function formatWeekStatusLine(summary: CourseWeekSummary): string {
  if (summary.pendingTaskCount === 0) {
    return `${summary.weekNo}주차: 완료`;
  }

  const parts = [
    `영상 ${summary.pendingTaskTypeCounts.VOD}개`,
    `과제 ${summary.pendingTaskTypeCounts.ASSIGNMENT}개`,
    `시험 ${summary.pendingTaskTypeCounts.QUIZ}개`,
    `기타 ${summary.pendingTaskTypeCounts.ETC}개`,
  ];
  return `${summary.weekNo}주차: 미완료 ${summary.pendingTaskCount}개 (${parts.join(", ")})`;
}

function formatCourseWeekHealth(course: Course): string {
  if (course.weekSummaries.length === 0) return "주차 데이터 없음";
  const pendingWeeks = course.weekSummaries.filter((entry) => entry.pendingTaskCount > 0);
  const stableCount = course.weekSummaries.length - pendingWeeks.length;
  return `총 ${course.weekSummaries.length}주차 중 ${stableCount}주차 정상, ${pendingWeeks.length}주차 미완료`;
}

function formatPendingWeeks(course: Course): string {
  const pendingWeeks = course.weekSummaries.filter((summary) => summary.pendingTaskCount > 0);
  if (pendingWeeks.length === 0) return "미완료 주차 없음";
  return pendingWeeks.map(formatWeekStatusLine).join(" | ");
}

function formatNextDeadline(task: Course["nextPendingTask"]): string {
  return toDateTime(task?.dueAt ?? task?.availableFrom ?? null);
}

function sanitizeNotificationMessage(message: string): string {
  return message
    .replace(/^(?:\s*\[[^\]]+\]\s*)?/, "")
    .replace(/\s*(아직|미확인|읽지않음|not-read|not_checked)\s*$/gi, "")
    .trim();
}

export function DashboardClient({ initialUser }: DashboardClientProps) {
  const router = useRouter();
  const bootstrapRef = useRef(false);
  const lastInteractionAtRef = useRef(Date.now());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blockingMessage, setBlockingMessage] = useState<string | null>("데이터를 불러오는 중입니다...");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [context, setContext] = useState<SessionContext | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [siteNotices, setSiteNotices] = useState<SiteNotice[]>([]);
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
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

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

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);
    if (res.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }
    const payload = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "요청 실패");
    return payload;
  }, [router]);

  const refreshAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else {
      setLoading(true);
      if (!bootstrapSyncing) {
        setBlockingMessage("데이터를 불러오는 중입니다...");
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
      setSiteNotices(payload.siteNotices);
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
  }, [fetchJson, lectureSeq, bootstrapSyncing]);

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
      setBlockingMessage("최초 동기화를 진행 중입니다.");
      void runAction("SYNC", true);
    }
  }, [summary, loading, syncInProgress]);

  const broadcastNotices = useMemo(() => siteNotices.filter((notice) => notice.type === "BROADCAST"), [siteNotices]);
  const maintenanceNotice = useMemo(
    () => siteNotices.find((notice) => notice.type === "MAINTENANCE" && notice.isActive),
    [siteNotices],
  );

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
    if (!silent) setBlockingMessage(action === "SYNC" ? "동기화 요청 처리 중..." : "자동 수강 요청 처리 중...");
    try {
      if (action === "AUTOLEARN" && mode !== "ALL_COURSES" && !lectureSeq) throw new Error("강좌를 선택해 주세요.");
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
      setMessage(payload.notice ?? (payload.deduplicated ? "이미 진행 중인 작업이 있습니다." : "요청을 접수했습니다."));
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message);
      setBootstrapSyncing(false);
    } finally {
      setActionSubmitting(false);
      if (!bootstrapSyncing) setBlockingMessage(null);
    }
  }

  async function cancelTrackingJob() {
    if (!trackingJobId) return;
    if (!trackingCanCancel || cancelSubmitting) return;
    setCancelSubmitting(true);
    setBlockingMessage("작업 취소를 요청 중입니다...");
    try {
      const payload = await fetchJson<{ status: Job["status"]; updated: boolean }>(`/api/jobs/${trackingJobId}/cancel`, {
        method: "POST",
      });
      setMessage(payload.updated ? "작업이 취소 처리되었습니다." : `현재 상태: ${payload.status}`);
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelSubmitting(false);
      if (!bootstrapSyncing) {
        setBlockingMessage(null);
      }
    }
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
    setBlockingMessage("공지 목록을 불러오는 중...");
    try {
      const payload = await fetchJson<{ notices: Notice[] }>(`/api/dashboard/courses/${course.lectureSeq}/notices`);
      setNotices(payload.notices);
      setActiveNotice(payload.notices[0] ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNoticeLoading(false);
      setBlockingMessage(null);
    }
  }

  async function markNoticeRead(noticeId: string) {
    await fetchJson(`/api/dashboard/notices/${noticeId}/read`, { method: "PATCH" });
    setNotices((prev) => prev.map((item) => (item.id === noticeId ? { ...item, isRead: true } : item)));
  }

  async function saveMail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mailDraft) return;
    setMailSaving(true);
    setBlockingMessage("메일 설정 저장 중...");
    try {
      await fetchJson("/api/mail/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mailDraft),
      });
      setIsMailSetupRequired(false);
      setSettingsOpen(false);
      setMessage("메일 설정을 저장했습니다.");
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
      <header className="topbar">
        <div className="topbar-brand">
          <img
            src="/brand/catholic/crest-mark.png"
            alt="Catholic University crest"
            loading="lazy"
          />
          <div>
            <p className="brand-kicker">CU12 자동화 · 학습 운영 대시보드</p>
            <h1>나의 학습 홈</h1>
            <div className="topbar-stats">
              <span className="action-kicker">{context?.effective.email ?? initialUser.email}</span>
              {context?.impersonating ? (
                <span className="error-text">관리자 대리 실행 모드: {context?.effective.email}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="icon-btn"
            onClick={() => void refreshAll(false)}
            disabled={loading || refreshing}
            title="새로고침"
            type="button"
          >
            <RotateCw size={16} />
          </button>
          <ThemeToggle />
          <Link className="ghost-btn" href={"/notices" as any}>
            전체 공지
          </Link>
          <Link className="ghost-btn" href={"/maintenance" as any}>
            점검 안내
          </Link>
          <NotificationCenter
            notifications={notifications}
            onOpen={setActiveNotification}
            onMarkRead={(item) => {
              if (item.isUnread) {
                void markNotificationRead(item);
              }
            }}
          />
          <UserMenu
            email={context?.effective.email ?? initialUser.email}
            role={initialUser.role}
            impersonating={context?.impersonating ?? false}
            onDashboard={() => {}}
            onGoAdmin={initialUser.role === "ADMIN" ? () => router.push("/admin" as Route) : undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            onLogout={logout}
          />
        </div>
      </header>
      {refreshing ? <p className="muted">자동 갱신 중...</p> : null}

      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <section className="grid-4">
        <article className="card"><h2>진행 강좌</h2><p className="metric">{summary?.activeCourseCount ?? 0}</p></article>
        <article className="card"><h2>평균 진도율</h2><p className="metric">{Math.round(summary?.avgProgress ?? 0)}%</p></article>
        <article className="card"><h2>미확인 공지</h2><p className="metric">{summary?.unreadNoticeCount ?? 0}</p></article>
        <article className="card"><h2>임박 차시</h2><p className="metric">{summary?.urgentTaskCount ?? 0}</p></article>
      </section>

      {maintenanceNotice ? (
        <section className="card">
          <h2>시스템 점검 공지</h2>
          <p className="error-text">현재 시스템 점검 중입니다. 일부 기능이 일시 제한될 수 있습니다.</p>
          <article className="notice-detail">
            <h3>{maintenanceNotice.title}</h3>
            <p className="muted">
              우선순위 {maintenanceNotice.priority} · {maintenanceNotice.updatedAt ? new Date(maintenanceNotice.updatedAt).toLocaleString("ko-KR") : "-"}
            </p>
            <pre>{maintenanceNotice.message || "공지 내용이 없습니다."}</pre>
          </article>
        </section>
      ) : null}

      {broadcastNotices.length > 0 ? (
        <section className="card">
          <h2>전체 공지</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제목</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {broadcastNotices.map((notice) => (
                  <tr key={notice.id}>
                    <td>{notice.title}</td>
                    <td>{notice.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>자동 수강</h2>
        <div className="button-row">
          <button onClick={() => setConfirm("SYNC")} disabled={actionSubmitting || syncInProgress}>{syncInProgress ? "동기화 진행 중" : "즉시 동기화"}</button>
          <button onClick={() => setConfirm("AUTOLEARN")} disabled={actionSubmitting || autoInProgress}>{autoInProgress ? "자동 수강 진행 중" : "자동 수강 요청"}</button>
        </div>
        <div className="form-grid top-gap">
          <label className="field">
            <span>모드</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES")}>
              <option value="ALL_COURSES">전체 강좌</option>
              <option value="SINGLE_ALL">선택 강좌 전체</option>
              <option value="SINGLE_NEXT">선택 강좌 다음 차시</option>
            </select>
          </label>
          <label className="field">
            <span>대상 강좌</span>
            <select value={lectureSeq ?? ""} onChange={(event) => setLectureSeq(Number(event.target.value))} disabled={mode === "ALL_COURSES"}>
              <option value="">강좌 선택</option>
              {courses.map((course) => <option key={course.lectureSeq} value={course.lectureSeq}>{course.title}</option>)}
            </select>
          </label>
        </div>
        {trackingDetail ? (
          <div className="form-stack top-gap">
            <p className="muted">
              작업 상태: {trackingDetail.status}
              {autoProgress
                ? ` (${autoProgress.progress.completedTasks}/${autoProgress.progress.totalTasks}, ${formatSeconds(autoProgress.progress.estimatedRemainingSeconds)} 남음)`
                : ""}
            </p>
            {trackingCanCancel ? (
              <div className="button-row">
                <button
                  className="ghost-btn"
                  style={{ borderColor: "rgb(180 35 24 / 45%)", color: "var(--danger)" }}
                  onClick={() => void cancelTrackingJob()}
                  disabled={cancelSubmitting}
                >
                  {cancelSubmitting ? "작업 중단 요청 중..." : "작업 즉시 중단"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>마감 임박 차시</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>강좌</th><th>주차/차시</th><th>학습인정기간</th><th>남은 시간</th></tr></thead>
            <tbody>
              {deadlines.length === 0 ? <tr><td colSpan={4}>임박 차시가 없습니다.</td></tr> : deadlines.map((item) => (
                <tr key={`${item.lectureSeq}:${item.courseContentsSeq}`}>
                  <td>{item.courseTitle}</td>
                  <td>{item.weekNo}주차 {item.lessonNo}차시</td>
                  <td>{toDateTime(item.availableFrom)} ~ {toDateTime(item.dueAt)}</td>
                  <td>{formatDays(item.daysLeft)} / {formatSeconds(item.remainingSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>미확인 알림</h2>
        <div className="notification-list">
            {unreadNotifications.length === 0 ? <p className="muted">새 알림이 없습니다.</p> : unreadNotifications.map((item) => (
              <button
                key={item.id}
                className="notification-item is-unread"
                onClick={() => void markNotificationRead(item)}
              >
                <span>{item.courseTitle || "시스템"}</span>
                <span className="muted notification-item-message">{sanitizeNotificationMessage(item.message)}</span>
                <span>{toDateTime(item.occurredAt ?? item.createdAt)}</span>
              </button>
            ))}
          </div>
        </section>

      <section className="card">
        <h2>강좌 현황</h2>
        <div className="course-grid">
          {courses.map((course) => {
                const currentWeekSummary = findCurrentWeekSummary(course);
                const weekSummaryLabel = formatCourseWeekProgress(course);
                const currentWeekPendingLabel = formatPendingByType(currentWeekSummary);
                const deadlineLabel = course.deadlineLabel === "이번 차시 마감" ? "이번 차시 마감" : "다음 차시 마감";
                const weekHealthLabel = formatCourseWeekHealth(course);
                const pendingWeeksLabel = formatPendingWeeks(course);

            return (
              <article key={course.lectureSeq} className="course-card">
                <h3>{course.title}</h3>
                <p className="muted">담당 교수: {course.instructor ?? "-"}</p>
                <p>진도율 <strong>{course.progressPercent}%</strong></p>
                <p className="muted">전체 과제: 총 {course.totalTaskCount}개 / 완료 {course.completedTaskCount}개 / 미완료 {course.pendingTaskCount}개</p>
                <p className="muted">{weekSummaryLabel}</p>
                <p className="muted">현재 기준 주차: {course.currentWeekNo ?? "-"}</p>
                <p className="muted">{weekHealthLabel}</p>
                <p className="muted">현재주차 미완료: {currentWeekPendingLabel}</p>
                <p className="muted">현재주차 미완료 유형: {formatTaskCountsByType(currentWeekSummary ? currentWeekSummary.pendingTaskTypeCounts : course.pendingTaskTypeCounts)}</p>
                <p className="muted">전체 유형 분포: {formatTaskCountsByType(course.taskTypeCounts)}</p>
                <p className="muted">미완료 주차 상세: {pendingWeeksLabel}</p>
                <p className="muted">공지: 총 {course.noticeCount}개 / 미확인 {course.unreadNoticeCount}개</p>
                <p className="muted">{deadlineLabel}: {formatNextDeadline(course.nextPendingTask)}</p>
                <button className="ghost-btn" onClick={() => void openNotices(course)}>공지 보기</button>
              </article>
            );
          })}
        </div>
      </section>

      {confirm ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>{confirm === "SYNC" ? "동기화 실행" : "자동 수강 실행"}</h2>
            <div className="button-row">
              <button onClick={() => void runAction(confirm)}>실행</button>
              <button className="ghost-btn" onClick={() => setConfirm(null)}>취소</button>
            </div>
          </section>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-overlay">
          <section className="modal-card wide">
            <h2>회원 설정</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr><th>CU12 아이디</th><td>{account?.cu12Id ?? "-"}</td></tr>
                  <tr><th>캠퍼스</th><td>{account?.campus ?? "-"}</td></tr>
                  <tr><th>계정 상태</th><td>{account?.accountStatus ?? "-"}{account?.statusReason ? ` / ${account.statusReason}` : ""}</td></tr>
                  <tr><th>마지막 동기화</th><td>{toDateTime(summary?.lastSyncAt ?? null)}</td></tr>
                  <tr><th>다음 마감</th><td>{toDateTime(summary?.nextDeadlineAt ?? null)}</td></tr>
                </tbody>
              </table>
            </div>
            {mailDraft ? (
              <form onSubmit={saveMail} className="form-stack top-gap">
                <label className="field"><span>수신 이메일</span><input type="email" value={mailDraft.email} onChange={(event) => setMailDraft({ ...mailDraft, email: event.target.value })} required /></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.enabled} onChange={(event) => setMailDraft({ ...mailDraft, enabled: event.target.checked })} /><span>메일 알림 사용</span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnNotice} onChange={(event) => setMailDraft({ ...mailDraft, alertOnNotice: event.target.checked })} /><span>신규 공지/알림 즉시 발송</span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnDeadline} onChange={(event) => setMailDraft({ ...mailDraft, alertOnDeadline: event.target.checked })} /><span>차시 마감 임박 알림</span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.alertOnAutolearn} onChange={(event) => setMailDraft({ ...mailDraft, alertOnAutolearn: event.target.checked })} /><span>자동 수강 결과 발송</span></label>
                <label className="check-field"><input type="checkbox" checked={mailDraft.digestEnabled} onChange={(event) => setMailDraft({ ...mailDraft, digestEnabled: event.target.checked })} /><span>일일 요약 메일</span></label>
                <label className="field"><span>요약 시각 (0~23)</span><input type="number" min={0} max={23} value={mailDraft.digestHour} onChange={(event) => setMailDraft({ ...mailDraft, digestHour: Number(event.target.value) })} /></label>
                {isMailSetupRequired ? (
                  <p className="error-text" style={{ marginBottom: "4px" }}>
                    최초 접속 사용자입니다. 메일 주소와 알림 설정을 저장해야 대시보드를 계속 사용할 수 있습니다.
                  </p>
                ) : null}
                <div className="button-row">
                  <button type="submit" disabled={mailSaving}>{mailSaving ? "저장 중..." : "저장"}</button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setSettingsOpen(false)}
                    disabled={mailSaving || isMailSetupRequired}
                  >
                    닫기
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
            <h2>{noticeCourse?.title ?? "강좌 공지"}</h2>
            {noticeLoading ? <p className="muted">공지 로딩 중...</p> : null}
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
                    <p className="muted">{toDateTime(activeNotice.postedAt)} · {activeNotice.author ?? "작성자 미상"}</p>
                    <pre>{activeNotice.bodyText || "본문 없음"}</pre>
                  </>
                ) : <p className="muted">공지를 선택해 주세요.</p>}
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {activeNotification ? (
        <div className="modal-overlay" onClick={() => setActiveNotification(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>{activeNotification.courseTitle || "시스템 알림"}</h2>
            <p className="muted">{toDateTime(activeNotification.occurredAt ?? activeNotification.createdAt)}</p>
            <p>{sanitizeNotificationMessage(activeNotification.message)}</p>
            <button className="ghost-btn" onClick={() => setActiveNotification(null)}>닫기</button>
          </section>
        </div>
      ) : null}

      {blockingMessage ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>처리 중</h2>
            <p className="muted">{blockingMessage}</p>
            <div className="loading-bar"><span /></div>
          </section>
        </div>
      ) : null}
    </>
  );
}

