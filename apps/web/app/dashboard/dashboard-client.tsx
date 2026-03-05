"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotificationCenter } from "../../components/notifications/notification-center";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
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
  nextAutoSyncAt: string | null;
  autoSyncIntervalHours: number;
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
  isArchived?: boolean;
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
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  result?: unknown;
}

interface JobDispatch {
  jobId: string;
  deduplicated: boolean;
  dispatched?: boolean;
  dispatchState?: "DISPATCHED" | "NOT_CONFIGURED" | "FAILED" | "SKIPPED_DUPLICATE";
  dispatchError?: string;
  dispatchErrorCode?: string | null;
  notice?: string;
}

interface RunCancelResult {
  state: "REQUESTED" | "NOT_CONFIGURED" | "NOT_APPLICABLE" | "FAILED";
  runId: number | null;
  errorCode: string | null;
  error?: string;
}

interface JobCancelResponse {
  status: Job["status"];
  updated: boolean;
  runCancel?: RunCancelResult;
}

interface JobDetail {
  status: Job["status"];
  type: Job["type"];
  updatedAt?: string | null;
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
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}

interface AutoProgress {
  kind: "AUTOLEARN_PROGRESS";
  updatedAt?: string;
  heartbeatAt?: string;
  progress: {
    phase: "PLANNING" | "RUNNING" | "DONE";
    mode: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";
    totalTasks: number;
    completedTasks: number;
    watchedSeconds: number;
    estimatedRemainingSeconds: number;
    current?: {
      lectureSeq: number;
      weekNo: number;
      lessonNo: number;
      remainingSeconds: number;
      elapsedSeconds?: number;
      courseTitle?: string;
      taskTitle?: string;
    };
  };
}

interface SyncProgress {
  kind: "SYNC_PROGRESS";
  updatedAt?: string;
  progress: {
    phase: "COURSES" | "NOTICES" | "TASKS" | "NOTIFICATIONS" | "DONE";
    totalCourses: number;
    completedCourses: number;
    noticeCount: number;
    taskCount: number;
    notificationCount: number;
    elapsedSeconds?: number;
    estimatedRemainingSeconds?: number | null;
    current?: {
      lectureSeq: number;
      title: string;
    };
  };
}

type SyncQueueState = "IDLE" | "RUNNING" | "RUNNING_STALE" | "PENDING" | "PENDING_STALE";
type DeadlineFilter = "D7" | "ALL";

const BROADCAST_NOTICE_DISMISS_KEY = "dashboard:dismissedBroadcastNoticeIds:v1";
const SITE_NOTICE_HOST_ID = "dashboard-site-notice-host";
const MAINTENANCE_NOTICE_ID = "maintenance-notice";

const TERMINAL = new Set<Job["status"]>(["SUCCEEDED", "FAILED", "CANCELED"]);
const POLL_ACTIVE_MS = 120000;
const POLL_IDLE_MS = 300000;
const POLL_IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const POLL_ACTIVE_WITH_WORK_MS = 45000;
const POLL_TRACKING_MS = 10000;
const POLL_TRACKING_RUNNING_MS = 2500;
const POLL_TRACKING_PENDING_MS = 4500;
const POLL_TRACKING_HIDDEN_MS = 12000;
const SYNC_PENDING_STALE_MS = 5 * 60 * 1000;
const SYNC_RUNNING_STALE_MS = 10 * 60 * 1000;

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

function toDateTimeWithFallback(value: string | null, fallback: string): string {
  return value ? toDateTime(value) : fallback;
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

function parseSyncProgress(value: unknown): SyncProgress | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as Partial<SyncProgress>;
  if (maybe.kind !== "SYNC_PROGRESS" || !maybe.progress) return null;
  return maybe as SyncProgress;
}

function toRatio(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total));
}

function formatAutoModeLabel(mode: AutoProgress["progress"]["mode"]): string {
  if (mode === "SINGLE_NEXT") return "선택 강좌 다음 차시";
  if (mode === "SINGLE_ALL") return "선택 강좌 전체";
  return "전체 강좌";
}

function getAutoModeDescription(mode: AutoProgress["progress"]["mode"]): string {
  if (mode === "SINGLE_NEXT") return "선택 강좌의 다음 미완료 VOD 1개를 자동 수강합니다.";
  if (mode === "SINGLE_ALL") return "선택 강좌의 미완료 VOD를 처음부터 끝까지 자동 수강합니다.";
  return "진행 중인 전체 강좌의 미완료 VOD를 순서대로 자동 수강합니다.";
}

function formatAutoPhaseLabel(phase: AutoProgress["progress"]["phase"]): string {
  if (phase === "PLANNING") return "대상 차시 계산 중";
  if (phase === "RUNNING") return "자동 수강 실행 중";
  return "자동 수강 완료";
}

function formatSyncPhaseLabel(phase: SyncProgress["progress"]["phase"]): string {
  if (phase === "COURSES") return "강좌 목록 확인";
  if (phase === "NOTICES") return "강좌 공지 수집";
  if (phase === "TASKS") return "강좌 차시 수집";
  if (phase === "NOTIFICATIONS") return "알림 수집";
  return "동기화 완료";
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function analyzeSyncQueueState(jobs: Job[], nowMs: number): {
  state: SyncQueueState;
  staleJobIds: string[];
  statusMessage: string;
} {
  let hasRunningFresh = false;
  let hasPendingFresh = false;
  let hasStaleRunning = false;
  let hasStalePending = false;
  const staleJobIds: string[] = [];

  for (const job of jobs) {
    if (job.type !== "SYNC" && job.type !== "NOTICE_SCAN") continue;

    if (job.status === "RUNNING") {
      const startedAtMs = parseDateMs(job.startedAt);
      const isStale = startedAtMs === null || nowMs - startedAtMs > SYNC_RUNNING_STALE_MS;
      if (isStale) staleJobIds.push(job.id);
      else hasRunningFresh = true;
      if (isStale) hasStaleRunning = true;
      continue;
    }

    if (job.status === "PENDING") {
      const createdAtMs = parseDateMs(job.createdAt);
      const isStale = createdAtMs === null || nowMs - createdAtMs > SYNC_PENDING_STALE_MS;
      if (isStale) staleJobIds.push(job.id);
      if (isStale) hasStalePending = true;
      else hasPendingFresh = true;
    }
  }

  if (hasRunningFresh) {
    return {
      state: "RUNNING",
      staleJobIds: [],
      statusMessage: "동기화 작업이 진행 중입니다.",
    };
  }

  if (hasPendingFresh) {
    return {
      state: hasStaleRunning ? "RUNNING_STALE" : "PENDING",
      staleJobIds,
      statusMessage: "동기화 요청이 접수되었습니다. 워커 시작을 대기 중입니다.",
    };
  }

  if (hasStaleRunning) {
    return {
      state: "RUNNING_STALE",
      staleJobIds,
      statusMessage: "동기화 작업이 장시간 진행되거나 멈춘 상태입니다.",
    };
  }

  if (hasStalePending) {
    return {
      state: "PENDING_STALE",
      staleJobIds,
      statusMessage: "동기화 요청이 오래되어 처리되지 않았을 수 있습니다.",
    };
  }

  return {
    state: "IDLE",
    staleJobIds: [],
    statusMessage: "",
  };
}

function formatTaskCountsByType(counts: ActivityTypeCounts): string {
  return `영상 ${counts.VOD}개 / 과제 ${counts.ASSIGNMENT}개 / 시험 ${counts.QUIZ}개 / 기타 ${counts.ETC}개`;
}

function getSyncQueueGuidance(state: SyncQueueState): string | null {
  switch (state) {
    case "PENDING":
      return "대기(PENDING)는 정상 상태입니다. 보통 수십 초~수 분 내에 자동 시작됩니다.";
    case "PENDING_STALE":
      return "대기 시간이 길어졌습니다. 워커 지연 시 '오래된 동기화 요청 정리'로 정리 후 다시 요청하세요.";
    case "RUNNING_STALE":
      return "실행 시간이 길어졌습니다. 필요하면 취소 후 다시 요청하세요.";
    default:
      return null;
  }
}

function formatRunCancelStatus(result: RunCancelResult | undefined): string {
  if (!result) return "";
  if (result.state === "REQUESTED") {
    return result.runId ? ` GitHub Action(run ${result.runId}) 취소를 요청했습니다.` : " GitHub Action 취소를 요청했습니다.";
  }
  if (result.state === "FAILED") {
    return " GitHub Action 취소 요청은 실패했습니다.";
  }
  return "";
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

function getPendingWeeks(course: Course): CourseWeekSummary[] {
  return course.weekSummaries.filter((summary) => summary.pendingTaskCount > 0);
}

function formatNextDeadline(task: Course["nextPendingTask"]): string {
  return toDateTime(task?.dueAt ?? task?.availableFrom ?? null);
}

function sanitizeNotificationMessage(message: string): string {
  return message
    .replace(/^(?:\s*\[[^\]]+\]\s*)?/, "")
    .replace(/\s*(미확인|읽지않음|not-read|not_checked|아직\s*읽지\s*않음)\s*$/gi, "")
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
  const [allDeadlines, setAllDeadlines] = useState<Deadline[] | null>(null);
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>("D7");
  const [deadlineLoading, setDeadlineLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<Notification[]>([]);
  const [notificationHistoryOpen, setNotificationHistoryOpen] = useState(false);
  const [notificationHistoryLoading, setNotificationHistoryLoading] = useState(false);
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
  const [syncQueueCleanupSubmitting, setSyncQueueCleanupSubmitting] = useState(false);
  const [notificationClearing, setNotificationClearing] = useState(false);

  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeCourse, setNoticeCourse] = useState<Course | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activeNotice, setActiveNotice] = useState<Notice | null>(null);
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);
  const [dismissedBroadcastNoticeIds, setDismissedBroadcastNoticeIds] = useState<Set<string>>(() => new Set());
  const [expandedNoticeIds, setExpandedNoticeIds] = useState<Set<string>>(() => new Set());
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<number>>(() => new Set());

  const dedupedSiteNotices = useMemo(() => {
    const seen = new Set<string>();
    return siteNotices.filter((notice) => {
      const key = [
        notice.type,
        notice.title.trim().toLowerCase(),
        notice.message.trim().toLowerCase(),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [siteNotices]);

  const sortedJobs = useMemo(
    () => [...jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jobs],
  );
  const syncQueueAnalysis = useMemo(() => analyzeSyncQueueState(jobs, Date.now()), [jobs]);
  const syncQueueState = syncQueueAnalysis.state;
  const syncQueueStaleJobIds = syncQueueAnalysis.staleJobIds;
  const syncQueueStatusMessage = syncQueueAnalysis.statusMessage;
  const syncQueueGuidance = useMemo(() => getSyncQueueGuidance(syncQueueState), [syncQueueState]);
  const hasActiveJobs = useMemo(() => jobs.some((job) => !TERMINAL.has(job.status)), [jobs]);
  const syncInProgress = syncQueueState !== "IDLE";
  const autoInProgress = sortedJobs.some((job) => job.type === "AUTOLEARN" && (job.status === "PENDING" || job.status === "RUNNING"));
  const activeSyncJob = useMemo(
    () =>
      sortedJobs.find(
        (job) =>
          (job.type === "SYNC" || job.type === "NOTICE_SCAN")
          && (job.status === "PENDING" || job.status === "RUNNING"),
      ) ?? null,
    [sortedJobs],
  );
  const activeAutoJob = useMemo(
    () =>
      sortedJobs.find(
        (job) =>
          job.type === "AUTOLEARN"
          && (job.status === "PENDING" || job.status === "RUNNING"),
      ) ?? null,
    [sortedJobs],
  );
  const canCancelActiveSync = Boolean(activeSyncJob);
  const selectedAutoCourse = useMemo(
    () => (lectureSeq ? courses.find((course) => course.lectureSeq === lectureSeq) ?? null : null),
    [courses, lectureSeq],
  );
  const canExecuteAutoLearn = mode === "ALL_COURSES" || Boolean(selectedAutoCourse);
  const autoConfirmTarget = mode === "ALL_COURSES"
    ? "모든 진행 강좌"
    : selectedAutoCourse
      ? `${selectedAutoCourse.title} (${selectedAutoCourse.lectureSeq})`
      : "강좌 선택 필요";
  const deadlineD7Items = useMemo(
    () => deadlines.filter((item) => item.daysLeft !== null && item.daysLeft >= 0 && item.daysLeft <= 7),
    [deadlines],
  );
  const deadlineAllItems = deadlineFilter === "ALL"
    ? allDeadlines ?? deadlines
    : deadlines;
  const displayedDeadlines = deadlineFilter === "D7"
    ? deadlineD7Items
    : deadlineAllItems;
  const trackingAutoLearn = trackingDetail?.type === "AUTOLEARN";
  const trackingSyncJob = trackingDetail?.type === "SYNC" || trackingDetail?.type === "NOTICE_SCAN";
  const syncProgress = trackingSyncJob
    ? parseSyncProgress(trackingDetail?.result)
    : parseSyncProgress(activeSyncJob?.result);
  const autoProgress = trackingAutoLearn
    ? parseAutoProgress(trackingDetail?.result)
    : parseAutoProgress(activeAutoJob?.result);
  const syncProgressRatio = syncProgress
    ? toRatio(syncProgress.progress.completedCourses, Math.max(1, syncProgress.progress.totalCourses))
    : 0;
  const autoProgressRatio = autoProgress
    ? toRatio(autoProgress.progress.completedTasks, Math.max(1, autoProgress.progress.totalTasks))
    : 0;
  const syncProgressStatus = trackingSyncJob ? trackingDetail?.status : activeSyncJob?.status ?? null;
  const autoProgressStatus = trackingAutoLearn ? trackingDetail?.status : activeAutoJob?.status ?? null;
  const autoProgressUpdatedAtRaw = autoProgress?.heartbeatAt
    ?? autoProgress?.updatedAt
    ?? (trackingAutoLearn ? trackingDetail?.updatedAt : activeAutoJob?.updatedAt)
    ?? null;
  const autoProgressUpdatedAtMs = parseDateMs(autoProgressUpdatedAtRaw);
  const autoProgressLagSeconds = autoProgressUpdatedAtMs === null
    ? null
    : Math.max(0, Math.floor((Date.now() - autoProgressUpdatedAtMs) / 1000));
  const autoProgressHeartbeatStale = autoProgressStatus === "RUNNING"
    && autoProgressLagSeconds !== null
    && autoProgressLagSeconds > 90;
  const autoCurrentTitle = autoProgress?.progress.current
    ? autoProgress.progress.current.taskTitle?.trim()
      || autoProgress.progress.current.courseTitle?.trim()
      || `강좌 ${autoProgress.progress.current.lectureSeq}`
    : null;
  const trackingCanCancel = trackingDetail?.status === "RUNNING" || trackingDetail?.status === "PENDING";
  const syncButtonLabel = useMemo(() => {
    switch (syncQueueState) {
      case "RUNNING":
        return "동기화 진행 중";
      case "RUNNING_STALE":
        return "동기화 진행 지연";
      case "PENDING":
        return "동기화 대기 중";
      case "PENDING_STALE":
        return "동기화 대기 지연";
      case "IDLE":
      default:
        return "즉시 동기화";
    }
  }, [syncQueueState]);

  const fetchJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const requestInit: RequestInit = { ...(init ?? {}) };
    const method = (requestInit.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") {
      requestInit.cache = "no-store";
    }
    const res = await fetch(url, requestInit);
    if (res.status === 401) {
      router.push("/login" as Route);
      throw new Error("Unauthorized");
    }
    const payload = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? "요청 실패");
    return payload;
  }, [router]);

  const loadNotificationHistory = useCallback(async () => {
    setNotificationHistoryLoading(true);
    try {
      const payload = await fetchJson<{ notifications: Notification[] }>(
        "/api/dashboard/notifications?historyOnly=1&includeArchived=1&limit=80",
      );
      setNotificationHistory(payload.notifications);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNotificationHistoryLoading(false);
    }
  }, [fetchJson]);

  const toggleNotificationHistory = useCallback(() => {
    setNotificationHistoryOpen((prev) => {
      if (!prev) {
        void loadNotificationHistory();
      }
      return !prev;
    });
  }, [loadNotificationHistory]);

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
      if (notificationHistoryOpen) {
        void loadNotificationHistory();
      }
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
  }, [fetchJson, lectureSeq, bootstrapSyncing, notificationHistoryOpen, loadNotificationHistory]);

  useEffect(() => {
    void refreshAll(false);
  }, [refreshAll]);

  useEffect(() => {
    if (!message) return;
    toast.success(message, {
      duration: 2800,
      closeButton: true,
    });
    setMessage(null);
  }, [message]);

  useEffect(() => {
    const touch = () => {
      lastInteractionAtRef.current = Date.now();
    };

    const interactionEvents: Array<keyof DocumentEventMap> = ["mousemove", "mousedown", "keydown", "touchstart"];
    interactionEvents.forEach((eventName) => document.addEventListener(eventName, touch, { passive: true }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      const isHidden = document.hidden;
      const idleMs = Date.now() - lastInteractionAtRef.current;
      const nextMs = isHidden
        ? POLL_IDLE_MS
        : hasActiveJobs || trackingJobId
          ? POLL_ACTIVE_WITH_WORK_MS
          : idleMs >= POLL_IDLE_THRESHOLD_MS
            ? POLL_IDLE_MS
            : POLL_ACTIVE_MS;
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
  }, [refreshAll, hasActiveJobs, trackingJobId]);

  useEffect(() => {
    if (trackingJobId) return;
    const isTrackable = (job: Job) => job.type === "SYNC" || job.type === "NOTICE_SCAN" || job.type === "AUTOLEARN";
    const runningJob = sortedJobs.find((job) => isTrackable(job) && job.status === "RUNNING");
    const pendingJob = sortedJobs.find((job) => isTrackable(job) && job.status === "PENDING");
    const candidate = runningJob ?? pendingJob ?? null;
    if (!candidate) return;
    setTrackingJobId(candidate.id);
  }, [sortedJobs, trackingJobId]);

  useEffect(() => {
    if (!summary || loading) return;
    if (summary.initialSyncRequired && !syncInProgress && !bootstrapRef.current) {
      bootstrapRef.current = true;
      setBootstrapSyncing(true);
      setBlockingMessage("최초 동기화를 진행 중입니다.");
      void runAction("SYNC", true);
    }
  }, [summary, loading, syncInProgress]);

  const broadcastNotices = useMemo(
    () => dedupedSiteNotices.filter((notice) => notice.type === "BROADCAST"),
    [dedupedSiteNotices],
  );
  const visibleBroadcastNotices = useMemo(
    () => broadcastNotices.filter((notice) => !dismissedBroadcastNoticeIds.has(notice.id)),
    [broadcastNotices, dismissedBroadcastNoticeIds],
  );
  const maintenanceNotice = useMemo(
    () => dedupedSiteNotices.find((notice) => notice.type === "MAINTENANCE" && notice.isActive),
    [dedupedSiteNotices],
  );

  const dismissBroadcastNotice = useCallback((noticeId: string) => {
    setDismissedBroadcastNoticeIds((prev) => {
      if (prev.has(noticeId)) return prev;
      const next = new Set(prev);
      next.add(noticeId);
      try {
        window.sessionStorage.setItem(BROADCAST_NOTICE_DISMISS_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // no-op
      }
      return next;
    });
  }, []);

  const toggleNoticeExpanded = useCallback((noticeId: string) => {
    setExpandedNoticeIds((prev) => {
      const next = new Set(prev);
      if (next.has(noticeId)) {
        next.delete(noticeId);
      } else {
        next.add(noticeId);
      }
      return next;
    });
  }, []);

  const isNoticeExpanded = useCallback((noticeId: string) => {
    return expandedNoticeIds.has(noticeId);
  }, [expandedNoticeIds]);

  const getNoticeExpandedClass = useCallback((noticeId: string, baseClassName: string) => {
    return `${baseClassName} ${isNoticeExpanded(noticeId) ? "is-expanded" : "is-collapsed"}`;
  }, [isNoticeExpanded]);

  const siteNoticePortal = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!maintenanceNotice && visibleBroadcastNotices.length === 0) return null;
    const host = document.getElementById(SITE_NOTICE_HOST_ID);
    if (!host) return null;
    const maintenanceExpanded = isNoticeExpanded(MAINTENANCE_NOTICE_ID);

    return createPortal(
      <div className="session-notice-stack">
        {maintenanceNotice ? (
          <section
            className={getNoticeExpandedClass(MAINTENANCE_NOTICE_ID, "topbar-notice topbar-notice-warning session-notice-card maintenance-notice-card")}
            role="button"
            tabIndex={0}
            aria-expanded={maintenanceExpanded}
            onClick={() => toggleNoticeExpanded(MAINTENANCE_NOTICE_ID)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleNoticeExpanded(MAINTENANCE_NOTICE_ID);
              }
            }}
            onTouchStart={() => toggleNoticeExpanded(MAINTENANCE_NOTICE_ID)}
          >
            <p className="topbar-notice-title">시스템 점검 공지</p>
            <p className="topbar-notice-summary">현재 시스템 점검 중입니다. 일부 기능이 일시 제한될 수 있습니다.</p>
            {maintenanceExpanded ? (
              <>
                <p className="topbar-notice-subtitle">{maintenanceNotice.title}</p>
                <p className="topbar-notice-body">{maintenanceNotice.message || "공지 내용이 없습니다."}</p>
              </>
            ) : null}
          </section>
        ) : null}
        {visibleBroadcastNotices.length > 0 ? (
          visibleBroadcastNotices.map((notice) => (
            <section
              key={notice.id}
              className={getNoticeExpandedClass(notice.id, "topbar-notice topbar-notice-broadcast session-notice-card")}
              role="button"
              tabIndex={0}
              aria-expanded={isNoticeExpanded(notice.id)}
              onClick={() => toggleNoticeExpanded(notice.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleNoticeExpanded(notice.id);
                }
              }}
              onTouchStart={() => toggleNoticeExpanded(notice.id)}
            >
              <div className="topbar-notice-row">
                <p className="topbar-notice-title">전체 공지</p>
                <button
                  className="topbar-notice-dismiss ghost-btn"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissBroadcastNotice(notice.id);
                  }}
                >
                  닫기
                </button>
              </div>
              <p className="topbar-notice-subtitle">{notice.title}</p>
              <p className="topbar-notice-body muted">{notice.message}</p>
            </section>
          ))
        ) : null}
      </div>,
      host,
    );
    }, [maintenanceNotice, visibleBroadcastNotices, dismissedBroadcastNoticeIds, expandedNoticeIds, dismissBroadcastNotice, isNoticeExpanded, getNoticeExpandedClass, toggleNoticeExpanded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(BROADCAST_NOTICE_DISMISS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const next = new Set(
          parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
        );
        setDismissedBroadcastNoticeIds(next);
      }
    } catch {
      // keep default empty set
    }
  }, []);

  useEffect(() => {
    if (!trackingJobId) return;
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped) return;
      let nextMs = POLL_TRACKING_RUNNING_MS;
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
        if (detail.status === "PENDING") {
          nextMs = POLL_TRACKING_PENDING_MS;
        }
      } catch {}
      if (document.hidden) {
        nextMs = Math.max(nextMs, POLL_TRACKING_HIDDEN_MS);
      }
      timeoutId = setTimeout(poll, nextMs);
    };
    void poll();
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [trackingJobId, fetchJson, refreshAll]);

  useEffect(() => {
    if (deadlineFilter !== "ALL" || allDeadlines || deadlineLoading) return;

    let cancelled = false;
    const load = async () => {
      setDeadlineLoading(true);
      try {
        const payload = await fetchJson<{ deadlines: Deadline[] }>("/api/dashboard/deadlines?limit=100");
        if (!cancelled) {
          setAllDeadlines(payload.deadlines);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setDeadlineLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [deadlineFilter, allDeadlines, deadlineLoading, fetchJson]);

  async function cancelSyncQueueJobs() {
    if (!syncQueueStaleJobIds.length || syncQueueCleanupSubmitting) return;
    setSyncQueueCleanupSubmitting(true);
    setBlockingMessage("오래된 동기화 요청을 정리 중입니다...");
    let hasFailure = false;
    try {
      let cancelledCount = 0;
      for (const jobId of syncQueueStaleJobIds) {
        try {
          const payload = await fetchJson<{ status: Job["status"]; updated: boolean }>(`/api/jobs/${jobId}/cancel`, {
            method: "POST",
          });
          if (payload.updated) cancelledCount += 1;
        } catch (inner) {
          hasFailure = true;
        }
      }
      if (cancelledCount > 0) {
        setMessage(`${cancelledCount}건의 오래된 동기화 요청을 정리했습니다.`);
      } else if (hasFailure) {
        setMessage("일부 동기화 요청 정리에 실패했습니다.");
      } else {
        setMessage("정리할 동기화 요청이 없습니다.");
      }
      await refreshAll(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncQueueCleanupSubmitting(false);
      if (!bootstrapSyncing) {
        setBlockingMessage(null);
      }
    }
  }

  async function runAction(action: "SYNC" | "AUTOLEARN", silent = false) {
    setActionSubmitting(true);
    setConfirm(null);
    setTrackingDetail(null);
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
      try {
        const detail = await fetchJson<JobDetail>(`/api/jobs/${payload.jobId}`);
        setTrackingDetail(detail);
      } catch {
        // Ignore hydration failure. Polling will continue.
      }
      const baseMessage = payload.notice ?? (payload.deduplicated ? "이미 진행 중인 작업이 있습니다." : "요청을 접수했습니다.");
      if (action === "SYNC" && payload.dispatched === false) {
        setMessage(`${baseMessage} 즉시 워커 실행 신호가 지연되어 큐 대기 후 자동 처리될 수 있습니다.`);
      } else {
        setMessage(baseMessage);
      }
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
      const payload = await fetchJson<JobCancelResponse>(`/api/jobs/${trackingJobId}/cancel`, {
        method: "POST",
      });
      if (payload.updated) {
        setMessage(`작업이 취소 처리되었습니다.${formatRunCancelStatus(payload.runCancel)}`);
      } else {
        setMessage(`현재 상태: ${payload.status}`);
      }
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

  async function cancelActiveSyncJob() {
    if (!activeSyncJob || cancelSubmitting) return;

    setCancelSubmitting(true);
    setBlockingMessage("동기화 작업 취소를 요청 중입니다...");
    try {
      const payload = await fetchJson<JobCancelResponse>(`/api/jobs/${activeSyncJob.id}/cancel`, {
        method: "POST",
      });
      if (payload.updated) {
        setMessage(`동기화 작업이 취소 처리되었습니다.${formatRunCancelStatus(payload.runCancel)}`);
      } else {
        setMessage(`현재 상태: ${payload.status}`);
      }
      if (trackingJobId === activeSyncJob.id) {
        setTrackingJobId(null);
        setTrackingDetail(null);
      }
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
    try {
      await fetchJson(`/api/dashboard/notifications/${item.id}/read`, { method: "PATCH" });
      setNotifications((prev) => prev.filter((row) => row.id !== item.id));
      if (notificationHistoryOpen) {
        void loadNotificationHistory();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function clearVisibleNotifications(ids: string[]) {
    if (ids.length === 0 || notificationClearing) return;
    setNotificationClearing(true);

    const uniqueIds = Array.from(new Set(ids));
    const targetIds = new Set(uniqueIds);

    try {
      const payload = await fetchJson<{ deletedCount: number }>("/api/dashboard/notifications", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds }),
      });

      setNotifications((prev) => prev.filter((item) => !targetIds.has(item.id)));
      setActiveNotification((prev) => (prev && targetIds.has(prev.id) ? null : prev));
      if (notificationHistoryOpen) {
        void loadNotificationHistory();
      }
      setMessage(`알림 ${payload.deletedCount}건을 예전 알림으로 이동했습니다.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setNotificationClearing(false);
    }
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

  function toggleCourseExpanded(lectureSeqValue: number) {
    setExpandedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(lectureSeqValue)) {
        next.delete(lectureSeqValue);
      } else {
        next.add(lectureSeqValue);
      }
      return next;
    });
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
      {siteNoticePortal}
      <header className="topbar">
        <div className="topbar-main">
          <div className="topbar-brand">
            <img
              src="/brand/catholic/crest-mark.png"
              alt="Catholic University crest"
              loading="lazy"
            />
            <div>
              <p className="brand-kicker">CU12 자동화 · 학습 운영 대시보드</p>
              <h1>나의 학습 홈</h1>
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
              historyNotifications={notificationHistory}
              showHistory={notificationHistoryOpen}
              historyLoading={notificationHistoryLoading}
              onToggleHistory={toggleNotificationHistory}
              onOpen={setActiveNotification}
              onMarkRead={(item) => {
                if (item.isUnread) {
                  void markNotificationRead(item);
                }
              }}
              onClearVisible={(ids) => {
                void clearVisibleNotifications(ids);
              }}
              clearing={notificationClearing}
            />
            <UserMenu
              email={context?.effective.email ?? initialUser.email}
              role={initialUser.role}
              impersonating={context?.impersonating ?? false}
              onDashboard={undefined}
              onGoAdmin={initialUser.role === "ADMIN" ? () => router.push("/admin" as Route) : undefined}
              onOpenSettings={() => setSettingsOpen(true)}
              onLogout={logout}
            />
          </div>
        </div>
      </header>
      {error ? <p className="error-text">{error}</p> : null}

      <section className="grid-kpi">
        <article className="card"><h2>진행 강좌</h2><p className="metric">{summary?.activeCourseCount ?? 0}</p></article>
        <article className="card"><h2>평균 진도율</h2><p className="metric">{Math.round(summary?.avgProgress ?? 0)}%</p></article>
        <article className="card"><h2>미확인 공지</h2><p className="metric">{summary?.unreadNoticeCount ?? 0}</p></article>
        <article className="card"><h2>임박 차시</h2><p className="metric">{summary?.urgentTaskCount ?? 0}</p></article>
        <article className="card">
          <h2>최근 동기화</h2>
          <p className="metric-sub">{toDateTimeWithFallback(summary?.lastSyncAt ?? null, "아직 동기화 이력 없음")}</p>
          <p className="muted text-small">다음 자동 동기화: {toDateTimeWithFallback(summary?.nextAutoSyncAt ?? null, "예정 계산 대기")}</p>
        </article>
      </section>

      <section className="card">
        <h2>학습 데이터 동기화</h2>
        <div className="sync-overview top-gap">
          <p><strong>마지막 동기화</strong>: {toDateTimeWithFallback(summary?.lastSyncAt ?? null, "아직 동기화 이력 없음")}</p>
          <p><strong>다음 자동 동기화</strong>: {toDateTimeWithFallback(summary?.nextAutoSyncAt ?? null, "예정 계산 대기")}</p>
          <p className="muted">
            현재는 {summary?.autoSyncIntervalHours ?? 2}시간마다 자동 동기화됩니다. 최신 데이터를 원하면 아래에서 수동 동기화를 실행하세요.
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => setConfirm("SYNC")} disabled={actionSubmitting || syncInProgress}>{syncButtonLabel}</button>
        </div>
        {syncInProgress ? (
          <>
            <p className="sync-status-note muted">동기화 상태: {syncQueueStatusMessage}</p>
            {syncQueueGuidance ? <p className="muted">{syncQueueGuidance}</p> : null}
          </>
        ) : null}
        {syncInProgress && canCancelActiveSync ? (
          <div className="button-row top-gap">
            <button
              type="button"
              className="ghost-btn"
              style={{ borderColor: "rgb(180 35 24 / 45%)", color: "var(--danger)" }}
              onClick={() => void cancelActiveSyncJob()}
              disabled={cancelSubmitting}
            >
              {cancelSubmitting ? "취소 요청 중..." : "동기화 작업 취소"}
            </button>
          </div>
        ) : null}
        {(syncQueueState === "PENDING_STALE" || syncQueueState === "RUNNING_STALE" || syncQueueState === "PENDING") &&
        syncQueueStaleJobIds.length > 0 ? (
          <div className="button-row top-gap">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void cancelSyncQueueJobs()}
              disabled={syncQueueCleanupSubmitting}
            >
              {syncQueueCleanupSubmitting ? "정리 중..." : "오래된 동기화 요청 정리"}
            </button>
          </div>
        ) : null}
        {syncProgressStatus || syncProgress ? (
          <div className="form-stack top-gap">
            <p className="muted">
              작업 상태: {syncProgressStatus ?? "-"}
              {syncProgress ? ` / 단계: ${formatSyncPhaseLabel(syncProgress.progress.phase)}` : ""}
            </p>
            {syncProgress ? (
              <>
                <div className="progress-track">
                  <div className="progress-value" style={{ width: `${Math.max(2, syncProgressRatio * 100)}%` }} />
                </div>
                <p className="muted">
                  강좌 {syncProgress.progress.completedCourses}/{Math.max(1, syncProgress.progress.totalCourses)} 처리
                  · 공지 {syncProgress.progress.noticeCount}건 · 차시 {syncProgress.progress.taskCount}건 · 알림 {syncProgress.progress.notificationCount}건
                </p>
                <p className="muted">
                  경과 {formatSeconds(syncProgress.progress.elapsedSeconds ?? 0)}
                  {" "}
                  · 남은 예상{" "}
                  {syncProgress.progress.estimatedRemainingSeconds === null || syncProgress.progress.estimatedRemainingSeconds === undefined
                    ? "계산 중"
                    : formatSeconds(syncProgress.progress.estimatedRemainingSeconds)}
                </p>
                {syncProgress.progress.current ? (
                  <p className="muted">
                    현재 강좌: {syncProgress.progress.current.title} ({syncProgress.progress.current.lectureSeq})
                  </p>
                ) : null}
              </>
            ) : null}
            {trackingDetail?.updatedAt ? (
              <p className="muted">최근 업데이트: {toDateTime(trackingDetail.updatedAt)}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>자동 수강</h2>
        <p className="muted">동기화된 최신 정보를 기준으로 자동 수강을 실행합니다.</p>
        <div className="button-row">
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
        {autoProgressStatus || autoProgress ? (
          <div className="form-stack top-gap">
            <p className="muted">
              작업 상태: {autoProgressStatus ?? "-"}
              {autoProgress
                ? ` / ${formatAutoPhaseLabel(autoProgress.progress.phase)}`
                : ""}
            </p>
            {autoProgress ? (
              <>
                <div className="progress-track">
                  <div className="progress-value" style={{ width: `${Math.max(2, autoProgressRatio * 100)}%` }} />
                </div>
                <p className="muted">
                  모드: {formatAutoModeLabel(autoProgress.progress.mode)} · 처리
                  {" "}
                  {autoProgress.progress.completedTasks}/{Math.max(1, autoProgress.progress.totalTasks)}
                  {" "}
                  · 남은 예상 {formatSeconds(autoProgress.progress.estimatedRemainingSeconds)}
                </p>
                {autoProgressUpdatedAtRaw ? (
                  <p className="muted">
                    최근 갱신: {toDateTime(autoProgressUpdatedAtRaw)}
                    {autoProgressLagSeconds !== null ? ` (${formatSeconds(autoProgressLagSeconds)} 전)` : ""}
                  </p>
                ) : null}
                {autoProgressHeartbeatStale ? (
                  <p className="muted" style={{ color: "var(--warn)" }}>
                    진행 신호가 지연 중입니다. 무진행 20분이면 자동으로 중단됩니다.
                  </p>
                ) : null}
                <p className="muted">누적 재생 시간: {formatSeconds(autoProgress.progress.watchedSeconds)}</p>
                {autoProgress.progress.current ? (
                  <>
                    <p className="muted">
                      현재 재생: {autoCurrentTitle} / {autoProgress.progress.current.weekNo}주차
                      {" "}
                      {autoProgress.progress.current.lessonNo}차시
                    </p>
                    <p className="muted">
                      강좌 식별값: {autoProgress.progress.current.lectureSeq}
                    </p>
                    <p className="muted">
                      현재 차시 경과: {formatSeconds(autoProgress.progress.current.elapsedSeconds ?? 0)}
                      {" "}
                      · 현재 차시 남은 예상: {formatSeconds(autoProgress.progress.current.remainingSeconds)}
                    </p>
                  </>
                ) : null}
              </>
            ) : null}
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
        <div className="deadline-filter-bar">
          <div className="button-row">
            <button
              type="button"
              className={`ghost-btn ${deadlineFilter === "D7" ? "is-active" : ""}`}
              onClick={() => setDeadlineFilter("D7")}
            >
              D-7 이내
            </button>
            <button
              type="button"
              className={`ghost-btn ${deadlineFilter === "ALL" ? "is-active" : ""}`}
              onClick={() => setDeadlineFilter("ALL")}
            >
              전체
            </button>
          </div>
          <p className="muted">
            표시 {displayedDeadlines.length}건
            {deadlineFilter === "D7" ? ` / 전체 ${deadlineAllItems.length}건` : ""}
          </p>
        </div>
        {deadlineFilter === "ALL" && deadlineLoading ? (
          <p className="muted">전체 마감 차시를 불러오는 중...</p>
        ) : null}
        <div className="table-wrap mobile-card-table">
          <table>
            <thead><tr><th>강좌</th><th>주차/차시</th><th>학습인정기간</th><th>남은 시간</th></tr></thead>
            <tbody>
              {displayedDeadlines.length === 0 ? <tr><td colSpan={4}>표시할 임박 차시가 없습니다.</td></tr> : displayedDeadlines.map((item) => (
                <tr key={`${item.lectureSeq}:${item.courseContentsSeq}`}>
                  <td data-label="강좌">{item.courseTitle}</td>
                  <td data-label="주차/차시">{item.weekNo}주차 {item.lessonNo}차시</td>
                  <td data-label="학습인정기간">{toDateTime(item.availableFrom)} ~ {toDateTime(item.dueAt)}</td>
                  <td data-label="남은 시간">{formatDays(item.daysLeft)} / {formatSeconds(item.remainingSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>강좌 현황</h2>
        <div className="course-grid">
          {courses.map((course) => {
            const currentWeekSummary = findCurrentWeekSummary(course);
            const currentWeekPendingLabel = formatPendingByType(currentWeekSummary);
            const pendingWeeks = getPendingWeeks(course);
            const isExpanded = expandedCourseIds.has(course.lectureSeq);
            const taskProgressRatio = toRatio(course.completedTaskCount, Math.max(1, course.totalTaskCount));

            return (
              <article key={course.lectureSeq} className={`course-card ${isExpanded ? "is-expanded" : ""}`}>
                <div className="course-overview">
                  <div className="course-overview-main">
                    <h3 className="course-title">{course.title}</h3>
                    <p className="muted">담당 교수: {course.instructor ?? "-"}</p>
                    <div className="progress-track course-progress-track">
                      <div className="progress-value" style={{ width: `${Math.max(2, taskProgressRatio * 100)}%` }} />
                    </div>
                    <p className="muted">
                      진도율 <strong>{course.progressPercent}%</strong>
                      {" · "}
                      과제 {course.completedTaskCount}/{course.totalTaskCount}
                    </p>
                  </div>
                  <div className="course-overview-meta">
                    <p>
                      <strong>{course.deadlineLabel}</strong>: {formatNextDeadline(course.nextPendingTask)}
                    </p>
                    <p className="muted">현재주차: {course.currentWeekNo ?? "-"}</p>
                    <p className="muted">미확인 공지: {course.unreadNoticeCount}개 / 전체 {course.noticeCount}개</p>
                  </div>
                  <div className="course-overview-actions">
                    <button className="ghost-btn" type="button" onClick={() => toggleCourseExpanded(course.lectureSeq)}>
                      {isExpanded ? "상세 닫기" : "상세 보기"}
                    </button>
                    <button className="ghost-btn" type="button" onClick={() => void openNotices(course)}>
                      공지 보기
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="course-detail-grid">
                    <p className="muted">{formatCourseWeekProgress(course)}</p>
                    <p className="muted">{formatCourseWeekHealth(course)}</p>
                    <p className="muted">현재주차 미완료: {currentWeekPendingLabel}</p>
                    <p className="muted">
                      현재주차 미완료 유형:
                      {" "}
                      {formatTaskCountsByType(currentWeekSummary ? currentWeekSummary.pendingTaskTypeCounts : course.pendingTaskTypeCounts)}
                    </p>
                    <p className="muted">전체 유형 분포: {formatTaskCountsByType(course.taskTypeCounts)}</p>
                    <div className="muted pending-week-detail">
                      <span className="pending-week-title">미완료 주차 상세:</span>
                      {pendingWeeks.length === 0 ? (
                        <span className="pending-week-empty">미완료 주차 없음</span>
                      ) : (
                        <ul className="pending-week-list">
                          {pendingWeeks.map((summary) => (
                            <li key={`${course.lectureSeq}:${summary.weekNo}`}>{formatWeekStatusLine(summary)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {confirm ? (
        <div className="modal-overlay">
          <section className="modal-card">
            <h2>{confirm === "SYNC" ? "동기화 실행" : "자동 수강 실행"}</h2>
            {confirm === "AUTOLEARN" ? (
              <div className="form-stack top-gap">
                <p className="muted">아래 설정으로 자동 수강을 요청합니다.</p>
                <div className="pill-note">
                  <p><strong>모드</strong>: {formatAutoModeLabel(mode)}</p>
                  <p><strong>대상</strong>: {autoConfirmTarget}</p>
                  <p className="muted">{getAutoModeDescription(mode)}</p>
                </div>
                {!canExecuteAutoLearn ? (
                  <p className="error-text">선택 강좌 모드에서는 대상 강좌를 먼저 선택해 주세요.</p>
                ) : null}
              </div>
            ) : null}
            <div className="button-row">
              <button
                onClick={() => void runAction(confirm)}
                disabled={confirm === "AUTOLEARN" && !canExecuteAutoLearn}
              >
                실행
              </button>
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
                  <tr><th>다음 자동 동기화</th><td>{toDateTime(summary?.nextAutoSyncAt ?? null)}</td></tr>
                  <tr><th>마지막 접속일</th><td>{toDateTime(account?.lastLoginAt ?? null)}</td></tr>
                  <tr><th>마지막 접속 IP</th><td>{account?.lastLoginIp ?? "-"}</td></tr>
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

