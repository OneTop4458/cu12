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

interface DashboardSummary {
  activeCourseCount: number;
  avgProgress: number;
  unreadNoticeCount: number;
  upcomingDeadlines: number;
  lastSyncAt: string | null;
  initialSyncRequired: boolean;
}

interface CourseItem {
  id: string;
  lectureSeq: number;
  title: string;
  instructor: string | null;
  progressPercent: number;
  remainDays: number | null;
  status: "ACTIVE" | "UPCOMING" | "ENDED";
  pendingTaskCount: number;
  completedTaskCount: number;
  totalTaskCount: number;
  totalRequiredSeconds: number;
  totalLearnedSeconds: number;
  currentWeekNo: number | null;
  nextPendingTask: {
    weekNo: number;
    lessonNo: number;
    activityType: "VOD" | "QUIZ" | "ASSIGNMENT" | "ETC";
  } | null;
}

interface CourseNoticeItem {
  id: string;
  lectureSeq: number;
  title: string;
  author: string | null;
  postedAt: string | null;
  bodyText: string;
  isNew: boolean;
  isRead: boolean;
}

interface NotificationItem {
  id: string;
  notifierSeq: string;
  courseTitle: string;
  category: string;
  message: string;
  occurredAt: string | null;
  isCanceled: boolean;
  isUnread: boolean;
  createdAt: string;
}

interface JobItem {
  id: string;
  type: "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  attempts: number;
  createdAt: string;
  lastError: string | null;
  result?: unknown;
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
  result?: unknown;
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

interface AutoLearnProgressResult {
  kind: "AUTOLEARN_PROGRESS";
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
    };
  };
  updatedAt: string;
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

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  if (hour > 0) return `${hour}시간 ${minute}분`;
  return `${minute}분`;
}

function formatRemainDays(days: number | null): string {
  if (days === null) return "-";
  if (days === 0) return "오늘 마감";
  if (days < 0) return "마감 지남";
  return `${days}일 남음`;
}

function autoLearnModeLabel(mode: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES") {
  switch (mode) {
    case "SINGLE_NEXT":
      return "선택 강좌 다음 차시";
    case "SINGLE_ALL":
      return "선택 강좌 전체";
    case "ALL_COURSES":
      return "전체 강좌";
    default:
      return mode;
  }
}

function asAutoLearnProgressResult(value: unknown): AutoLearnProgressResult | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as Partial<AutoLearnProgressResult>;
  if (maybe.kind !== "AUTOLEARN_PROGRESS" || !maybe.progress) {
    return null;
  }
  return maybe as AutoLearnProgressResult;
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [account, setAccount] = useState<Cu12AccountResponse["account"]>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const [mailPreference, setMailPreference] = useState<MailPreference | null>(null);
  const [mailDraft, setMailDraft] = useState<MailPreference | null>(null);
  const [mailSaving, setMailSaving] = useState(false);

  const [autoLearnMode, setAutoLearnMode] = useState<"SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES">("ALL_COURSES");
  const [autoLearnLectureSeq, setAutoLearnLectureSeq] = useState<number | null>(null);

  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [inviteCu12Id, setInviteCu12Id] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "USER">("USER");
  const [inviteExpiresHours, setInviteExpiresHours] = useState(72);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [latestInviteToken, setLatestInviteToken] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<"SYNC" | "AUTOLEARN" | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState<"SYNC" | "AUTOLEARN" | null>(null);

  const [trackingJobId, setTrackingJobId] = useState<string | null>(null);
  const [trackingDetail, setTrackingDetail] = useState<JobDetailResponse | null>(null);
  const [bootstrapSyncing, setBootstrapSyncing] = useState(false);
  const bootstrapRequestedRef = useRef(false);

  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeTargetCourse, setNoticeTargetCourse] = useState<CourseItem | null>(null);
  const [courseNotices, setCourseNotices] = useState<CourseNoticeItem[]>([]);
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [activeNotice, setActiveNotice] = useState<CourseNoticeItem | null>(null);

  const [activeNotification, setActiveNotification] = useState<NotificationItem | null>(null);

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

  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => item.isUnread).length,
    [notifications],
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

  const autoLearnProgress = useMemo(
    () => asAutoLearnProgressResult(trackingDetail?.result),
    [trackingDetail],
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
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const [summaryRes, coursesRes, jobsRes, accountRes, notificationsRes, mailRes] = await Promise.all([
        fetchJson<DashboardSummary>("/api/dashboard/summary"),
        fetchJson<{ courses: CourseItem[] }>("/api/dashboard/courses"),
        fetchJson<{ jobs: JobItem[] }>("/api/jobs?limit=25"),
        fetchJson<Cu12AccountResponse>("/api/cu12/account"),
        fetchJson<{ notifications: NotificationItem[] }>("/api/dashboard/notifications?limit=60"),
        fetchJson<{ preference: MailPreference }>("/api/mail/preferences"),
      ]);

      setSummary(summaryRes);
      setCourses(coursesRes.courses);
      setJobs(jobsRes.jobs);
      setAccount(accountRes.account);
      setNotifications(notificationsRes.notifications);
      setMailPreference(mailRes.preference);
      setMailDraft((prev) => prev ?? mailRes.preference);
      setLastRefreshedAt(new Date());

      if (autoLearnMode !== "ALL_COURSES" && coursesRes.courses.length > 0 && !autoLearnLectureSeq) {
        setAutoLearnLectureSeq(coursesRes.courses[0].lectureSeq);
      }

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
      } else {
        setRefreshing(false);
      }
    }
  }, [fetchJson, initialUser.role, autoLearnLectureSeq, autoLearnMode]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!summary || !account || loading) {
      return;
    }

    if (summary.initialSyncRequired && !syncInProgress && !bootstrapRequestedRef.current) {
      bootstrapRequestedRef.current = true;
      setBootstrapSyncing(true);
      setMessage("처음 접속하셨네요. 최초 동기화를 자동으로 시작합니다.");
      void runAction("SYNC", true);
    }
  }, [summary, account, loading, syncInProgress]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void refreshAll(true);
    }, 15000);

    return () => clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    if (!trackingJobId) {
      setTrackingDetail(null);
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
          setTrackingDetail(null);
          setBootstrapSyncing(false);
          return;
        }

        setTrackingDetail(payload);

        if (TERMINAL_JOB_STATUS.has(payload.status)) {
          setTrackingJobId(null);
          if (bootstrapSyncing) {
            setBootstrapSyncing(false);
          }
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
  }, [trackingJobId, refreshAll, router, bootstrapSyncing]);

  async function runAction(action: "SYNC" | "AUTOLEARN", silent = false) {
    setActionSubmitting(action);
    setConfirmAction(null);
    if (!silent) {
      setError(null);
      setMessage(null);
    }

    try {
      if (action === "AUTOLEARN" && autoLearnMode !== "ALL_COURSES" && !autoLearnLectureSeq) {
        setError("선택 강좌 자동수강은 강좌를 먼저 선택해야 합니다.");
        return;
      }

      const endpoint = action === "SYNC" ? "/api/jobs/sync-now" : "/api/jobs/autolearn-request";
      const init: RequestInit = action === "SYNC"
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: autoLearnMode,
              lectureSeq: autoLearnMode === "ALL_COURSES" ? undefined : autoLearnLectureSeq,
            }),
          };

      const payload = await fetchJson<JobDispatchResponse>(endpoint, init);
      setTrackingJobId(payload.jobId);

      if (!silent) {
        const fallbackNotice = payload.deduplicated
          ? "이미 진행 중인 작업이 있어 기존 작업 상태를 보여드립니다."
          : "작업 요청이 큐에 등록되었습니다.";

        const dispatchTail = payload.dispatched
          ? ""
          : " 워커 호출은 지연 중이며, 큐에서 순서대로 처리됩니다.";

        setMessage(`${payload.notice ?? fallbackNotice}${dispatchTail}`);
      }

      await refreshAll(true);
    } catch (actionError) {
      setError((actionError as Error).message);
      setBootstrapSyncing(false);
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

  async function openCourseNotices(course: CourseItem) {
    setNoticeModalOpen(true);
    setNoticeTargetCourse(course);
    setNoticeLoading(true);
    setActiveNotice(null);

    try {
      const payload = await fetchJson<{ notices: CourseNoticeItem[] }>(`/api/dashboard/courses/${course.lectureSeq}/notices`);
      setCourseNotices(payload.notices);
      if (payload.notices.length > 0) {
        setActiveNotice(payload.notices[0]);
      }
    } catch (openError) {
      setError((openError as Error).message);
    } finally {
      setNoticeLoading(false);
    }
  }

  async function markNoticeRead(notice: CourseNoticeItem) {
    if (notice.isRead) return;

    try {
      await fetchJson<{ updated: boolean }>(`/api/dashboard/notices/${notice.id}/read`, {
        method: "PATCH",
      });
      setCourseNotices((prev) => prev.map((item) => (
        item.id === notice.id ? { ...item, isRead: true } : item
      )));
      await refreshAll(true);
    } catch (markError) {
      setError((markError as Error).message);
    }
  }

  async function openNotification(item: NotificationItem) {
    setActiveNotification(item);
    if (!item.isUnread) return;

    try {
      await fetchJson<{ updated: boolean }>(`/api/dashboard/notifications/${item.id}/read`, {
        method: "PATCH",
      });
      setNotifications((prev) => prev.map((row) => (
        row.id === item.id ? { ...row, isUnread: false } : row
      )));
      await refreshAll(true);
    } catch (markError) {
      setError((markError as Error).message);
    }
  }

  async function saveMailPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mailDraft) return;

    setMailSaving(true);
    setError(null);

    try {
      const payload = await fetchJson<{ preference: MailPreference }>("/api/mail/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mailDraft),
      });
      setMailPreference(payload.preference);
      setMailDraft(payload.preference);
      setMessage("메일 알림 설정을 저장했습니다.");
    } catch (mailError) {
      setError((mailError as Error).message);
    } finally {
      setMailSaving(false);
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
          <p className="brand-kicker">가톨릭대학교 공유대학</p>
          <h1>나의 학습 현황</h1>
          <p className="muted">
            {initialUser.email} · {initialUser.role === "ADMIN" ? "관리자" : "사용자"}
          </p>
        </div>
        <div className="header-actions">
          <button
            className="ghost-btn"
            onClick={() => void refreshAll(true)}
            disabled={refreshing}
          >
            {refreshing ? "새로고침 중..." : "지금 새로고침"}
          </button>
          <button onClick={logout}>로그아웃</button>
        </div>
      </header>

      {loading ? <p>데이터를 불러오는 중입니다...</p> : null}
      {refreshing ? <p className="muted">데이터를 자동 갱신하고 있습니다...</p> : null}
      {lastRefreshedAt ? <p className="muted">마지막 갱신: {toDateTime(lastRefreshedAt.toISOString())}</p> : null}
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
          <h2>읽지 않은 공지</h2>
          <p className="metric">{summary?.unreadNoticeCount ?? 0}</p>
        </article>
        <article className="card">
          <h2>읽지 않은 알림</h2>
          <p className="metric">{unreadNotificationCount}</p>
        </article>
      </section>

      <section className="card">
        <h2>자동수강 진행 상황</h2>
        {trackingDetail ? (
          <div className="progress-wrap">
            <p>
              작업 상태: <span className={`status-chip status-${trackingDetail.status.toLowerCase()}`}>
                {jobStatusLabel(trackingDetail.status)}
              </span>
            </p>
            {autoLearnProgress ? (
              <>
                <p className="muted">
                  모드: {autoLearnModeLabel(autoLearnProgress.progress.mode)} ·
                  진행: {autoLearnProgress.progress.completedTasks}/{autoLearnProgress.progress.totalTasks}
                </p>
                <div className="progress-track" role="presentation">
                  <span
                    className="progress-value"
                    style={{
                      width: `${autoLearnProgress.progress.totalTasks > 0
                        ? Math.round((autoLearnProgress.progress.completedTasks / autoLearnProgress.progress.totalTasks) * 100)
                        : 0}%`,
                    }}
                  />
                </div>
                <p className="muted">
                  누적 재생: {formatSeconds(autoLearnProgress.progress.watchedSeconds)} · 예상 남은 시간: {formatSeconds(autoLearnProgress.progress.estimatedRemainingSeconds)}
                </p>
              </>
            ) : (
              <p className="muted">실시간 진행 정보가 준비되는 중입니다.</p>
            )}
          </div>
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
        <p className="muted">
          중복 요청은 자동으로 합쳐집니다. 진행 중 작업이 있으면 완료될 때까지 버튼이 비활성화됩니다.
        </p>
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
        </div>
        <div className="form-grid top-gap">
          <label className="field">
            <span>자동수강 모드</span>
            <select
              value={autoLearnMode}
              onChange={(event) =>
                setAutoLearnMode(event.target.value as "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES")
              }
            >
              <option value="ALL_COURSES">전체 강좌 미수강 차시</option>
              <option value="SINGLE_ALL">선택 강좌 전체 미수강 차시</option>
              <option value="SINGLE_NEXT">선택 강좌 다음 차시 1개</option>
            </select>
          </label>
          <label className="field">
            <span>대상 강좌</span>
            <select
              value={autoLearnLectureSeq ?? ""}
              onChange={(event) => setAutoLearnLectureSeq(Number(event.target.value))}
              disabled={autoLearnMode === "ALL_COURSES"}
            >
              <option value="">강좌 선택</option>
              {courses.map((course) => (
                <option key={course.lectureSeq} value={course.lectureSeq}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
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
                <tr>
                  <th>메일 알림</th>
                  <td>{mailPreference?.enabled ? "ON" : "OFF"}</td>
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

          <p className="muted">이미 사용된 초대코드는 만료 시각과 무관하게 항상 USED 상태로 표시됩니다.</p>

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
        <h2>강좌별 현황</h2>
        <div className="course-grid">
          {courses.length === 0 ? (
            <article className="course-card">
              <p className="muted">표시할 강좌가 없습니다.</p>
            </article>
          ) : (
            courses.map((course) => (
              <article key={course.lectureSeq} className="course-card">
                <div className="course-head">
                  <h3>{course.title}</h3>
                  <span className={`status-chip status-${course.status.toLowerCase()}`}>
                    {courseStatusLabel(course.status)}
                  </span>
                </div>
                <p className="muted">담당 교수: {course.instructor ?? "-"}</p>
                <p>진도율 <strong>{course.progressPercent}%</strong></p>
                <p className="muted">
                  현재 주차: {course.currentWeekNo ?? "-"} · 남은 기간: {formatRemainDays(course.remainDays)}
                </p>
                <p className="muted">
                  미완료 차시 {course.pendingTaskCount}개 / 완료 {course.completedTaskCount}개
                </p>
                <div className="button-row top-gap">
                  <button className="ghost-btn" onClick={() => void openCourseNotices(course)}>
                    공지 확인
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <h2>미확인 알림</h2>
        <p className="muted">알림을 누르면 상세 내용을 확인하고 읽음 처리됩니다.</p>
        <div className="notification-list">
          {notifications.length === 0 ? (
            <p className="muted">새 알림이 없습니다.</p>
          ) : (
            notifications.slice(0, 20).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notification-item ${item.isUnread ? "is-unread" : ""}`}
                onClick={() => void openNotification(item)}
              >
                <span>{item.courseTitle || "시스템"}</span>
                <span className="muted">{item.message}</span>
                <span className="muted">{toDateTime(item.occurredAt ?? item.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <h2>메일 알림 설정</h2>
        <p className="muted">수강 마감/공지/자동수강 결과를 메일로 받을 수 있습니다.</p>
        {mailDraft ? (
          <form onSubmit={saveMailPreference} className="form-stack top-gap">
            <label className="field">
              <span>수신 이메일</span>
              <input
                type="email"
                value={mailDraft.email}
                onChange={(event) => setMailDraft({ ...mailDraft, email: event.target.value })}
                required
              />
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={mailDraft.enabled}
                onChange={(event) => setMailDraft({ ...mailDraft, enabled: event.target.checked })}
              />
              <span>메일 알림 사용</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={mailDraft.alertOnNotice}
                onChange={(event) => setMailDraft({ ...mailDraft, alertOnNotice: event.target.checked })}
              />
              <span>신규 공지/알림 즉시 발송</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={mailDraft.alertOnDeadline}
                onChange={(event) => setMailDraft({ ...mailDraft, alertOnDeadline: event.target.checked })}
              />
              <span>마감 임박 강좌 알림 발송</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={mailDraft.alertOnAutolearn}
                onChange={(event) => setMailDraft({ ...mailDraft, alertOnAutolearn: event.target.checked })}
              />
              <span>자동수강 완료 결과 발송</span>
            </label>

            <label className="check-field">
              <input
                type="checkbox"
                checked={mailDraft.digestEnabled}
                onChange={(event) => setMailDraft({ ...mailDraft, digestEnabled: event.target.checked })}
              />
              <span>일일 요약 메일 발송</span>
            </label>

            <label className="field">
              <span>요약 메일 기준 시각(0~23)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={mailDraft.digestHour}
                onChange={(event) => setMailDraft({ ...mailDraft, digestHour: Number(event.target.value) })}
              />
            </label>

            <button type="submit" disabled={mailSaving}>
              {mailSaving ? "저장 중..." : "메일 설정 저장"}
            </button>
          </form>
        ) : (
          <p className="muted">메일 설정을 불러오지 못했습니다.</p>
        )}
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
                : `자동수강 모드: ${autoLearnModeLabel(autoLearnMode)} · 영상 길이만큼 시간이 걸릴 수 있으며 큐에서 순차 처리됩니다.`}
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

      {noticeModalOpen ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setNoticeModalOpen(false)}
        >
          <section
            className="modal-card wide"
            role="dialog"
            aria-modal="true"
            aria-label="강좌 공지"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{noticeTargetCourse?.title ?? "강좌 공지"}</h2>
            {noticeLoading ? <p className="muted">공지 목록을 불러오는 중...</p> : null}
            {!noticeLoading && courseNotices.length === 0 ? (
              <p className="muted">등록된 공지가 없습니다.</p>
            ) : null}

            {!noticeLoading && courseNotices.length > 0 ? (
              <div className="notice-layout">
                <div className="notice-list">
                  {courseNotices.map((notice) => (
                    <button
                      key={notice.id}
                      type="button"
                      className={`notification-item ${notice.isRead ? "" : "is-unread"}`}
                      onClick={() => {
                        setActiveNotice(notice);
                        void markNoticeRead(notice);
                      }}
                    >
                      <span>{notice.title}</span>
                      <span className="muted">{toDateTime(notice.postedAt)}</span>
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
                  ) : (
                    <p className="muted">좌측 공지를 선택해 주세요.</p>
                  )}
                </article>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeNotification ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setActiveNotification(null)}
        >
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="알림 상세"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{activeNotification.courseTitle || "시스템 알림"}</h2>
            <p className="muted">{toDateTime(activeNotification.occurredAt ?? activeNotification.createdAt)}</p>
            <p>{activeNotification.message}</p>
            <div className="button-row">
              <button type="button" className="ghost-btn" onClick={() => setActiveNotification(null)}>닫기</button>
            </div>
          </section>
        </div>
      ) : null}

      {bootstrapSyncing ? (
        <div className="modal-overlay" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="초기 동기화 진행 중">
            <h2>초기 동기화 진행 중</h2>
            <p className="muted">첫 화면 준비를 위해 수강 정보와 공지를 가져오는 중입니다.</p>
            <div className="loading-bar" role="presentation">
              <span />
            </div>
            <p className="muted">창을 닫지 말고 잠시만 기다려 주세요.</p>
          </section>
        </div>
      ) : null}
    </>
  );
}
