import type { PortalProvider } from "@cu12/core";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { chromium } from "playwright";
import {
  claimJob,
  failJob,
  finishJob,
  hasPendingJobs,
  progressJob,
  requestWorkerDispatch,
  sendHeartbeat,
} from "./internal-api";
import {
  collectCu12Snapshot,
  runAutoLearning,
  type AutoLearnPlannedTask,
  type AutoLearnMode,
  type AutoLearnProgress,
  type SyncProgress,
  type Cu12Credentials,
} from "./cu12-automation";
import { processCyberCampusApproval } from "./cyber-campus-approval";
import { collectCyberCampusSnapshot, runCyberCampusAutoLearning } from "./cyber-campus-sync";
import { resolveReusableCyberCampusSessionOptions } from "./cyber-campus-session-options";
import { collectCu12SnapshotViaHttp } from "./cu12-http-sync";
import { getEnv } from "./env";
import {
  buildAutoLearnResultMail,
  buildAutoLearnStartMail,
  buildAutoLearnTerminalMail,
  buildDigestMail,
  buildPolicyUpdateMail,
  buildSyncAlertMail,
} from "./mail-content";
import {
  formatAutoLearnFailureLog,
  formatAutoLearnStartLog,
  formatAutoLearnSummaryLog,
} from "./autolearn-log";
import {
  getMandatoryMailRecipient,
  getPortalApprovalSessionByJobId,
  getUserCu12Credentials,
  getUserMailPreference,
  getPortalSessionCookieState,
  invalidatePortalSession,
  markAccountConnected,
  markAccountNeedsReauth,
  markTaskDeadlineAlerted,
  persistSnapshot,
  recordLearningRun,
  recordMailDelivery,
} from "./sync-store";
import { prisma } from "./prisma";
import { sendMail } from "./mail";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatProviderName(provider: PortalProvider): string {
  return provider === "CYBER_CAMPUS" ? "사이버캠퍼스" : "CU12";
}

function daysUntil(target: Date, now: Date): number {
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function startHeartbeatLoop(workerId: string, intervalMs: number) {
  let stopped = false;
  const send = () => {
    if (stopped) return;
    void sendHeartbeat(workerId).catch(() => {});
  };

  send();
  const timer = setInterval(send, Math.max(5_000, intervalMs));

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function writeAuditLog(input: {
  category: "WORKER" | "MAIL" | "PARSER" | "JOB";
  severity?: "INFO" | "WARN" | "ERROR";
  targetUserId?: string;
  message: string;
  meta?: unknown;
}) {
  const meta =
    input.meta === undefined
      ? undefined
      : input.meta === null
        ? Prisma.JsonNull
        : (input.meta as Prisma.InputJsonValue);

  await prisma.auditLog.create({
    data: {
      category: input.category,
      severity: input.severity ?? "INFO",
      targetUserId: input.targetUserId ?? null,
      message: input.message,
      meta,
    },
  });
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  const sec = safe % 60;

  if (hour > 0) {
    return `${hour}시간 ${minute}분 ${sec}초`;
  }
  if (minute > 0) {
    return `${minute}분 ${sec}초`;
  }
  return `${sec}초`;
}

const DASHBOARD_SECTION_ID = {
  OVERVIEW: "overview",
  NOTIFICATIONS: "notifications",
  DEADLINES: "deadlines",
  JOBS: "jobs",
  COURSES: "courses",
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toSnippet(value: string | null | undefined, maxLength = 140): string {
  const normalized = normalizeInlineText(value ?? "");
  if (!normalized) return "-";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function formatKoDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return parsed.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

function toPercent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return "0%";
  }
  return `${Math.round((Math.max(0, numerator) / denominator) * 100)}%`;
}

function buildDashboardLink(anchor?: string): string {
  const baseUrl = getEnv().WEB_INTERNAL_BASE_URL.replace(/\/+$/, "");
  const dashboard = `${baseUrl}/dashboard`;
  if (!anchor) return dashboard;
  return `${dashboard}#${encodeURIComponent(anchor)}`;
}

function renderMailList(items: string[], limit = 8): string {
  if (items.length === 0) return '<p style="margin:0;color:#4b5563;">-</p>';

  const visible = items.slice(0, Math.max(1, limit));
  const hiddenCount = Math.max(0, items.length - visible.length);

  return `
    <ul style="margin:8px 0 0;padding:0 0 0 18px;color:#111827;">
      ${visible.join("")}
    </ul>
    ${hiddenCount > 0 ? `<p style="margin:8px 0 0;color:#6b7280;">${hiddenCount}개 항목은 생략되었습니다. 전체 목록은 대시보드에서 확인하세요.</p>` : ""}
  `;
}

function renderMailSection(title: string, bodyHtml: string, link?: { href: string; label: string }): string {
  return `
    <section style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;background:#f9fafb;">
      <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      ${link
    ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(link.href)}" style="color:#0f3b8a;text-decoration:underline;">${escapeHtml(link.label)}</a></p>`
    : ""}
    </section>
  `;
}

function renderMailLayout(input: {
  title: string;
  subtitle: string;
  summaryRows: Array<{ label: string; value: string }>;
  sections: string[];
  primaryLink?: { href: string; label: string };
}): string {
  const summaryRowsHtml = input.summaryRows
    .map(
      (row) => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#4b5563;white-space:nowrap;">${escapeHtml(row.label)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Arial,sans-serif;color:#111827;">
    <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
      <article style="background:#ffffff;border:1px solid #d9e1ea;border-radius:16px;padding:20px;">
        <h1 style="margin:0 0 8px;font-size:22px;color:#0f172a;">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 16px;color:#334155;">${escapeHtml(input.subtitle)}</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tbody>${summaryRowsHtml}</tbody>
        </table>
        ${input.primaryLink
    ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(input.primaryLink.href)}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0f3b8a;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(input.primaryLink.label)}</a></p>`
    : ""}
        <div style="display:grid;gap:12px;">
          ${input.sections.join("")}
        </div>
        <p style="margin:18px 0 0;color:#6b7280;font-size:12px;">이 메일은 CU12 자동화 워커에서 자동 발송되었습니다.</p>
      </article>
    </div>
  </body>
</html>`;
}

function formatAutoLearnModeLabel(mode: AutoLearnMode): string {
  if (mode === "SINGLE_NEXT") return "선택 강좌: 다음 차시";
  if (mode === "SINGLE_ALL") return "선택 강좌: 전체 차시";
  return "진행 중 전체 강좌";
}

function formatAutoLearnNoOpReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "NO_ACTIVE_COURSES") return "진행 중인 강좌가 없습니다.";
  if (reason === "LECTURE_NOT_FOUND") return "선택한 강좌를 찾을 수 없습니다.";
  if (reason === "NO_PENDING_TASKS") return "미완료 차시가 없습니다.";
  if (reason === "NO_PENDING_VOD_TASKS") return "미완료 VOD 차시가 없습니다.";
  if (reason === "NO_AVAILABLE_VOD_TASKS") return "현재 학습 가능 시간대의 VOD 차시가 없습니다.";
  if (reason === "NO_TASKS_AFTER_FILTER") return "필터 적용 후 남은 차시가 없습니다.";
  if (reason === "NO_PENDING_SUPPORTED_TASKS") return "자동 처리 가능한 미완료 학습 항목이 없습니다.";
  if (reason === "NO_AVAILABLE_SUPPORTED_TASKS") return "현재 학습 가능 기간에 있는 자동 처리 학습 항목이 없습니다.";
  return reason;
}

type AutoLearnTerminalStatus = "SUCCEEDED" | "FAILED" | "CANCELED";

function formatAutoLearnTarget(mode: AutoLearnMode, lectureSeq?: number): string {
  if (mode === "ALL_COURSES") return "진행 중 전체 강좌";
  if (typeof lectureSeq === "number" && Number.isFinite(lectureSeq)) {
    return `강좌 ${lectureSeq}`;
  }
  return "선택 강좌";
}

function formatAutoLearnTerminalStatus(status: AutoLearnTerminalStatus): string {
  if (status === "SUCCEEDED") return "성공";
  if (status === "CANCELED") return "취소";
  return "실패";
}

function toAutoLearnMode(raw: unknown): AutoLearnMode {
  if (raw === "SINGLE_NEXT" || raw === "SINGLE_ALL" || raw === "ALL_COURSES") {
    return raw;
  }
  return "ALL_COURSES";
}

function toChainSegment(raw: unknown, fallback = 1): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(1, Math.floor(raw));
}

interface AutoLearnJobResultPayload {
  type: "AUTOLEARN";
  mode: AutoLearnMode;
  processedTaskCount: number;
  elapsedSeconds: number;
  plannedTaskCount: number;
  noOpReason?: string | null;
  planned?: AutoLearnPlannedTask[];
  truncated: boolean;
  estimatedTotalSeconds: number;
  chainSegment?: number;
}

function isAutoLearnJobResultPayload(value: unknown): value is AutoLearnJobResultPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "AUTOLEARN") return false;
  if (record.mode !== "SINGLE_NEXT" && record.mode !== "SINGLE_ALL" && record.mode !== "ALL_COURSES") return false;
  return typeof record.processedTaskCount === "number"
    && typeof record.elapsedSeconds === "number"
    && typeof record.plannedTaskCount === "number"
    && typeof record.truncated === "boolean"
    && typeof record.estimatedTotalSeconds === "number";
}

function parseArgs() {
  const map = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k && v) map.set(k, v);
  }
  return map;
}

interface PolicyUpdateMailPayload {
  userId: string;
  mailKind: "POLICY_UPDATE";
  policyChanges: Array<{
    title: string;
    currentVersion: number;
    previousVersion: number | null;
    currentPath: string;
    previousPath: string | null;
    diffPath: string | null;
  }>;
}

function isPolicyUpdateMailPayload(value: unknown): value is PolicyUpdateMailPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.mailKind !== "POLICY_UPDATE" || typeof record.userId !== "string") return false;
  return Array.isArray(record.policyChanges);
}

const AUTOLEARN_CANCEL_ERROR = "AUTOLEARN_CANCELLED";
const AUTOLEARN_STALLED_ERROR = "AUTOLEARN_STALLED";
const JOB_CANCEL_ERROR = "JOB_CANCELLED";

type CancelCheck = () => Promise<boolean>;

async function getJobStatus(jobId: string) {
  const job = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return job?.status ?? null;
}

function parseJobTypes(raw: string | undefined): JobType[] {
  const defaults = [JobType.SYNC, JobType.AUTOLEARN, JobType.NOTICE_SCAN, JobType.MAIL_DIGEST];
  if (!raw) return defaults;

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) return defaults;

  const unique = new Set<JobType>();
  for (const value of values) {
    if (!Object.values(JobType).includes(value as JobType)) {
      throw new Error(`Invalid --types value: ${value}`);
    }
    unique.add(value as JobType);
  }

  return [...unique];
}

function resolveHandoffTrigger(jobTypes: JobType[]): "autolearn" | "sync" | null {
  if (jobTypes.includes(JobType.AUTOLEARN)) return "autolearn";
  if (jobTypes.includes(JobType.SYNC) || jobTypes.includes(JobType.NOTICE_SCAN)) return "sync";
  return null;
}

async function reportJobProgress(jobId: string, workerId: string, progress: AutoLearnProgress) {
  try {
    await progressJob(jobId, workerId, {
      kind: "AUTOLEARN_PROGRESS",
      progress,
      updatedAt: new Date().toISOString(),
      heartbeatAt: progress.heartbeatAt ?? null,
    });
  } catch (error) {
    // progress update must not break the main worker flow
    console.warn(`[AUTOLEARN] progress sync failed job=${jobId}: ${errMessage(error)}`);
  }
}

async function reportSyncJobProgress(jobId: string, workerId: string, progress: SyncProgress) {
  try {
    await progressJob(jobId, workerId, {
      kind: "SYNC_PROGRESS",
      progress,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // progress update must not break the main worker flow
    console.warn(`[SYNC] progress sync failed job=${jobId}: ${errMessage(error)}`);
  }
}

async function sendSyncAlertMail(
  userId: string,
  provider: "CU12" | "CYBER_CAMPUS",
  summary: {
    newNoticeCount: number;
    newUnreadNotificationCount: number;
    newMessageCount: number;
    unreadMessageCount: number;
    newNotices: Array<{
      lectureSeq: number;
      noticeKey: string;
      title: string;
      author: string | null;
      postedAt: string | null;
      bodyText: string;
      courseTitle: string;
    }>;
    newUnreadNotifications: Array<{
      notifierSeq: string;
      courseTitle: string;
      category: string;
      message: string;
      occurredAt: string | null;
      isCanceled: boolean;
    }>;
    newMessages: Array<{
      messageSeq: string;
      title: string;
      senderName: string | null;
      sentAt: string | null;
    }>;
    deadlineTasks: Array<{
      lectureSeq: number;
      courseContentsSeq: number;
      weekNo: number;
      lessonNo: number;
      dueAt: string;
      courseTitle: string;
    }>;
  },
) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled) {
    return;
  }

  const deadlineAlerts: Array<{
    courseTitle: string;
    weekNo: number;
    lessonNo: number;
    dueAt: Date;
    daysLeft: number;
  }> = [];

  if (pref.alertOnDeadline && summary.deadlineTasks.length > 0) {
    const now = new Date();
    const thresholdSet = new Set([7, 3, 1, 0]);

    for (const task of summary.deadlineTasks) {
      const dueAt = new Date(task.dueAt);
      if (!Number.isFinite(dueAt.getTime())) continue;

      const daysLeft = daysUntil(dueAt, now);
      if (!thresholdSet.has(daysLeft)) continue;

      const inserted = await markTaskDeadlineAlerted(
        userId,
        provider,
        {
          lectureSeq: task.lectureSeq,
          courseContentsSeq: task.courseContentsSeq,
          dueAt,
        },
        daysLeft,
      );
      if (!inserted) continue;

      deadlineAlerts.push({
        courseTitle: task.courseTitle,
        weekNo: task.weekNo,
        lessonNo: task.lessonNo,
        dueAt,
        daysLeft,
      });
    }
  }

  const mailDocument = buildSyncAlertMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: new Date(),
    newNotices: pref.alertOnNotice ? summary.newNotices : [],
    newUnreadNotifications: pref.alertOnNotice ? summary.newUnreadNotifications : [],
    newMessages: pref.alertOnNotice ? summary.newMessages : [],
    unreadMessageCount: summary.unreadMessageCount,
    deadlineAlerts: pref.alertOnDeadline ? deadlineAlerts : [],
  });
  if (!mailDocument) {
    return;
  }

  try {
    const result = await sendMail(pref.email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Sync alert mail sent",
        meta: { to: pref.email, subject: mailDocument.subject },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Sync alert mail skipped",
      meta: { to: pref.email, subject: mailDocument.subject, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Sync alert mail failed",
      meta: { to: pref.email, subject: mailDocument.subject, error: errMessage(error) },
    });
  }
}

async function sendAutoLearnResultMail(
  userId: string,
  payload: {
    mode: AutoLearnMode;
    processedTaskCount: number;
    elapsedSeconds: number;
    watchedTaskCount: number;
    watchedSeconds: number;
    plannedTaskCount: number;
    truncated: boolean;
    continuationQueued?: boolean;
    chainLimitReached?: boolean;
    chainSegment?: number;
    estimatedTotalSeconds: number;
    noOpReason?: string | null;
    planned?: AutoLearnPlannedTask[];
  },
) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled || !pref.alertOnAutolearn) {
    return;
  }
  const mailDocument = buildAutoLearnResultMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: new Date(),
    mode: payload.mode,
    watchedTaskCount: payload.watchedTaskCount,
    watchedSeconds: payload.watchedSeconds,
    plannedTaskCount: payload.plannedTaskCount,
    truncated: payload.truncated,
    continuationQueued: payload.continuationQueued,
    chainLimitReached: payload.chainLimitReached,
    chainSegment: payload.chainSegment,
    estimatedTotalSeconds: payload.estimatedTotalSeconds,
    noOpReason: payload.noOpReason,
    planned: payload.planned,
  });

  try {
    const result = await sendMail(pref.email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Autolearn result mail sent",
        meta: { to: pref.email, subject: mailDocument.subject },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Autolearn result mail skipped",
      meta: { to: pref.email, subject: mailDocument.subject, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Autolearn result mail failed",
      meta: { to: pref.email, subject: mailDocument.subject, error: errMessage(error) },
    });
  }
}

async function sendAutoLearnStartMail(
  userId: string,
  payload: {
    mode: AutoLearnMode;
    lectureSeq?: number;
    chainSegment?: number;
  },
) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled || !pref.alertOnAutolearn) {
    return;
  }
  const mailDocument = buildAutoLearnStartMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: new Date(),
    mode: payload.mode,
    lectureSeq: payload.lectureSeq,
    chainSegment: payload.chainSegment,
  });

  try {
    const result = await sendMail(pref.email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Autolearn start mail sent",
        meta: { to: pref.email, subject: mailDocument.subject },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Autolearn start mail skipped",
      meta: { to: pref.email, subject: mailDocument.subject, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Autolearn start mail failed",
      meta: { to: pref.email, subject: mailDocument.subject, error: errMessage(error) },
    });
  }
}

async function sendAutoLearnTerminalMail(
  userId: string,
  payload: {
    status: AutoLearnTerminalStatus;
    mode: AutoLearnMode;
    lectureSeq?: number;
    chainSegment?: number;
    reason?: string | null;
  },
) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled || !pref.alertOnAutolearn) {
    return;
  }
  const mailDocument = buildAutoLearnTerminalMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: new Date(),
    status: payload.status,
    mode: payload.mode,
    lectureSeq: payload.lectureSeq,
    chainSegment: payload.chainSegment,
    reason: payload.reason,
  });

  try {
    const result = await sendMail(pref.email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Autolearn end mail sent",
        meta: { to: pref.email, subject: mailDocument.subject, status: payload.status },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Autolearn end mail skipped",
      meta: { to: pref.email, subject: mailDocument.subject, status: payload.status, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Autolearn end mail failed",
      meta: { to: pref.email, subject: mailDocument.subject, status: payload.status, error: errMessage(error) },
    });
  }
}
async function processSync(
  jobId: string,
  workerId: string,
  userId: string,
  jobType: "SYNC" | "NOTICE_SCAN",
  onCancelCheck?: CancelCheck,
  options?: {
    provider?: PortalProvider;
  },
) {
  const resultType: "SYNC" | "NOTICE_SCAN" = jobType === "NOTICE_SCAN" ? "NOTICE_SCAN" : "SYNC";
  const logPrefix = `[${resultType}]`;
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }
  const targetProvider = options?.provider ?? creds.provider;
  const cu12Campus = creds.campus === "SONGSIN" ? "SONGSIN" : creds.campus === "SONGSIM" ? "SONGSIM" : null;
  if (targetProvider === "CU12" && !cu12Campus) {
    throw new Error("CU12_CAMPUS_REQUIRED");
  }
  const cu12Creds: Cu12Credentials = {
    cu12Id: creds.cu12Id,
    cu12Password: creds.cu12Password,
    campus: cu12Campus ?? "SONGSIM",
  };

  const shouldCancel = onCancelCheck ?? (async () => false);
  const startedAtMs = Date.now();
  let lastProgressLogKey = "";
  console.log(`${logPrefix} started job=${jobId} user=${userId}`);
  try {
    const progressReporter = async (progress: SyncProgress) => {
      await reportSyncJobProgress(jobId, workerId, progress);
      const currentTitle = progress.current?.title ?? "-";
      const currentSeq = progress.current?.lectureSeq ?? 0;
      const key = [
        progress.phase,
        progress.completedCourses,
        progress.totalCourses,
        progress.noticeCount,
        progress.taskCount,
        progress.notificationCount,
        currentSeq,
      ].join(":");
      if (key === lastProgressLogKey) return;
      lastProgressLogKey = key;
      console.log(
        `${logPrefix} progress job=${jobId}`
        + ` phase=${progress.phase}`
        + ` courses=${progress.completedCourses}/${Math.max(1, progress.totalCourses)}`
        + ` notices=${progress.noticeCount}`
        + ` tasks=${progress.taskCount}`
        + ` notifications=${progress.notificationCount}`
        + ` elapsed=${Math.max(0, progress.elapsedSeconds ?? 0)}s`
        + ` eta=${progress.estimatedRemainingSeconds == null ? "calc" : `${Math.max(0, progress.estimatedRemainingSeconds)}s`}`
        + ` current=${currentTitle}(${currentSeq})`,
      );
    };
    const snapshot = targetProvider === "CYBER_CAMPUS"
      ? await (async () => {
        const browser = await chromium.launch({ headless: getEnv().PLAYWRIGHT_HEADLESS });
        try {
          return await collectCyberCampusSnapshot(
            browser,
            userId,
            {
              cu12Id: creds.cu12Id,
              cu12Password: creds.cu12Password,
            },
            shouldCancel,
            progressReporter,
          );
        } finally {
          await browser.close();
        }
      })()
      : await collectCu12SnapshotViaHttp(
        userId,
        cu12Creds,
        shouldCancel,
        progressReporter,
      );
    const persisted = await persistSnapshot(userId, targetProvider, snapshot);
    await markAccountConnected(userId);

    const courseTitleBySeq = new Map(snapshot.courses.map((course) => [course.lectureSeq, course.title]));
    const messageCount =
      "messages" in snapshot && Array.isArray((snapshot as { messages?: unknown[] }).messages)
        ? (snapshot as { messages: unknown[] }).messages.length
        : 0;

    await sendSyncAlertMail(userId, targetProvider, {
      newNoticeCount: persisted.newNoticeCount,
      newUnreadNotificationCount: persisted.newUnreadNotificationCount,
      newMessageCount: persisted.newMessageCount,
      unreadMessageCount: persisted.unreadMessageCount,
      newNotices: persisted.newNotices.map((notice) => ({
        ...notice,
        courseTitle: courseTitleBySeq.get(notice.lectureSeq) ?? `강좌 ${notice.lectureSeq}`,
      })),
      newUnreadNotifications: persisted.newUnreadNotifications,
      newMessages: persisted.newMessages,
      deadlineTasks: persisted.deadlineTasks.map((task) => ({
        ...task,
        courseTitle: courseTitleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`,
      })),
    });

    console.log(
      `${logPrefix} completed job=${jobId}`
      + ` courses=${snapshot.courses.length}`
      + ` notices=${snapshot.notices.length}`
      + ` tasks=${snapshot.tasks.length}`
      + ` notifications=${snapshot.notifications.length}`
      + ` messages=${messageCount}`
      + ` elapsed=${Math.max(1, Math.floor((Date.now() - startedAtMs) / 1000))}s`,
    );

    await writeAuditLog({
      category: "WORKER",
      severity: "INFO",
      targetUserId: userId,
      message: `${resultType} job completed`,
      meta: {
        jobId,
        type: resultType,
        courseCount: snapshot.courses.length,
        noticeCount: snapshot.notices.length,
        taskCount: snapshot.tasks.length,
        notificationCount: snapshot.notifications.length,
        messageCount,
      },
    });

    return {
      type: resultType,
      courses: snapshot.courses.length,
      notices: snapshot.notices.length,
      notifications: snapshot.notifications.length,
      tasks: snapshot.tasks.length,
      newNoticeCount: persisted.newNoticeCount,
      newNotificationCount: persisted.newNotificationCount,
      newMessageCount: persisted.newMessageCount,
      pendingTaskCount: persisted.pendingTaskCount,
      deadlineTaskCount: persisted.deadlineTasks.length,
    };
  } catch (error) {
    const message = errMessage(error);
    if (/login|Unauthorized|need/i.test(message)) {
      await markAccountNeedsReauth(userId, message);
    }
    const isCancelled = message === JOB_CANCEL_ERROR;
    if (isCancelled) {
      console.log(`${logPrefix} cancelled job=${jobId}`);
      await writeAuditLog({
        category: "WORKER",
        severity: "INFO",
        targetUserId: userId,
        message: `${resultType} job cancelled`,
        meta: {
          jobId,
          type: resultType,
        },
      });
      throw error;
    }

    console.error(`${logPrefix} failed job=${jobId}: ${message}`);
    await writeAuditLog({
      category: "WORKER",
      severity: "ERROR",
      targetUserId: userId,
      message: `${resultType} job failed`,
      meta: {
        jobId,
        type: resultType,
        error: message,
      },
    });
    throw error;
  }
}

async function processAutolearn(
  jobId: string,
  workerId: string,
  userId: string,
  mode: AutoLearnMode,
  lectureSeq?: number,
  onCancelCheck?: CancelCheck,
  options?: {
    chainSegment?: number;
    sendStartMail?: boolean;
    provider?: PortalProvider;
  },
) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }
  const targetProvider = options?.provider ?? creds.provider;
  const cu12Campus = creds.campus === "SONGSIN" ? "SONGSIN" : creds.campus === "SONGSIM" ? "SONGSIM" : null;
  if (targetProvider === "CU12" && !cu12Campus) {
    throw new Error("CU12_CAMPUS_REQUIRED");
  }
  const cyberCampusApprovalSession = targetProvider === "CYBER_CAMPUS"
    ? await getPortalApprovalSessionByJobId(jobId)
    : null;
  const completedApprovalCookieState = targetProvider === "CYBER_CAMPUS"
    && cyberCampusApprovalSession?.status === "COMPLETED"
    && cyberCampusApprovalSession.cookieState.length > 0
    ? cyberCampusApprovalSession.cookieState
    : undefined;
  const cyberCampusSession = targetProvider === "CYBER_CAMPUS"
    ? await getPortalSessionCookieState(userId, "CYBER_CAMPUS")
    : null;
  const reusableCyberCampusSessionOptions = targetProvider === "CYBER_CAMPUS"
    ? resolveReusableCyberCampusSessionOptions(cyberCampusSession)
    : undefined;
  const cyberCampusSessionOptions = targetProvider === "CYBER_CAMPUS"
    ? {
      cookieState: reusableCyberCampusSessionOptions?.cookieState ?? completedApprovalCookieState,
      restoreCookieStateAfterPlanningRefresh: completedApprovalCookieState,
    }
    : undefined;
  const cu12Creds: Cu12Credentials = {
    cu12Id: creds.cu12Id,
    cu12Password: creds.cu12Password,
    campus: cu12Campus ?? "SONGSIM",
  };

  const env = getEnv();
  const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  const stallTimeoutMs = Math.max(120_000, env.AUTOLEARN_STALL_TIMEOUT_SECONDS * 1000);
  let lastHeartbeatAtMs = Date.now();
  let lastHeartbeatAt = new Date(lastHeartbeatAtMs).toISOString();
  let stallDetected = false;
  const stallWatchdog = setInterval(() => {
    if (stallDetected) return;
    const idleMs = Date.now() - lastHeartbeatAtMs;
    if (idleMs <= stallTimeoutMs) return;
    stallDetected = true;
    console.error(`[AUTOLEARN] stalled job=${jobId} idle=${Math.floor(idleMs / 1000)}s`);
  }, 5000);
  if (options?.sendStartMail) {
    await sendAutoLearnStartMail(userId, {
      mode,
      lectureSeq,
      chainSegment: options.chainSegment,
    });
  }
  try {
    console.log(formatAutoLearnStartLog({
      jobId,
      provider: targetProvider,
      mode,
      lectureSeq: lectureSeq ?? null,
      chainSegment: options?.chainSegment,
    }));
    const progressReporter = async (progress: AutoLearnProgress) => {
      const nowIso = progress.heartbeatAt ?? new Date().toISOString();
      lastHeartbeatAt = nowIso;
      lastHeartbeatAtMs = Date.parse(nowIso) || Date.now();
      if (progress.phase === "RUNNING" && progress.current) {
        const elapsed = progress.current.elapsedSeconds ?? 0;
        const courseTitle = progress.current.courseTitle ?? `Course ${progress.current.lectureSeq}`;
        const taskTitle = progress.current.taskTitle ?? "-";
        console.log(
          `[AUTOLEARN] heartbeat job=${jobId} lecture=${progress.current.lectureSeq}`
          + ` week=${progress.current.weekNo} lesson=${progress.current.lessonNo}`
          + ` elapsed=${elapsed}s remaining=${progress.current.remainingSeconds}s`
          + ` total=${progress.elapsedSeconds}s`
          + ` course="${courseTitle}" task="${taskTitle}"`,
        );
      }
      await reportJobProgress(jobId, workerId, progress);
    };
    const cancelReporter = async () => {
      if (stallDetected) return true;
      const externalCancel = onCancelCheck ? await onCancelCheck() : false;
      if (externalCancel) return true;
      const status = await getJobStatus(jobId);
      return status === null || status === JobStatus.CANCELED;
    };
    const autoResult = targetProvider === "CYBER_CAMPUS"
      ? await runCyberCampusAutoLearning(
        browser,
        userId,
        {
          cu12Id: creds.cu12Id,
          cu12Password: creds.cu12Password,
        },
        { mode, lectureSeq },
        progressReporter,
        cancelReporter,
        {
          cookieState: cyberCampusSessionOptions?.cookieState,
          restoreCookieStateAfterPlanningRefresh: cyberCampusSessionOptions?.restoreCookieStateAfterPlanningRefresh,
        },
      )
      : await runAutoLearning(
        browser,
        userId,
        cu12Creds,
        {
          mode,
          lectureSeq,
          quizAutoSolveEnabled: creds.quizAutoSolveEnabled,
        },
        progressReporter,
        cancelReporter,
      );
    if (stallDetected) {
      throw new Error(AUTOLEARN_STALLED_ERROR);
    }
    clearInterval(stallWatchdog);

    console.log(formatAutoLearnSummaryLog({
      jobId,
      provider: targetProvider,
      mode: autoResult.mode,
      lectureSeq: lectureSeq ?? null,
      chainSegment: options?.chainSegment,
      plannedTaskCount: autoResult.plannedTaskCount,
      processedTaskCount: autoResult.processedTaskCount,
      noOpReason: autoResult.noOpReason,
      lectureSeqs: autoResult.lectureSeqs,
    }));

    await recordLearningRun(
      userId,
      targetProvider,
      lectureSeq ?? null,
      "SUCCESS",
      `provider=${targetProvider}, mode=${autoResult.mode}, lecture=${lectureSeq ?? "ALL"}, planned=${autoResult.plannedTaskCount}, processed=${autoResult.processedTaskCount}, noOp=${autoResult.noOpReason ?? "-"}`,
    );

    // Refresh snapshots after playback updates.
    const shouldCancel = onCancelCheck ?? (async () => false);
    const snapshot = targetProvider === "CYBER_CAMPUS"
      ? await collectCyberCampusSnapshot(
        browser,
        userId,
        {
          cu12Id: creds.cu12Id,
          cu12Password: creds.cu12Password,
        },
        shouldCancel,
        undefined,
        {
          cookieState: cyberCampusSessionOptions?.cookieState,
        },
      )
      : await collectCu12Snapshot(browser, userId, cu12Creds, shouldCancel);
    await persistSnapshot(userId, targetProvider, snapshot);

    await writeAuditLog({
      category: "WORKER",
      severity: "INFO",
      targetUserId: userId,
        message: "AUTOLEARN job completed",
        meta: {
          jobId,
          provider: targetProvider,
          mode: autoResult.mode,
          lectureSeq: lectureSeq ?? null,
          processedTaskCount: autoResult.processedTaskCount,
          noOpReason: autoResult.noOpReason,
          plannedTaskCount: autoResult.plannedTaskCount,
          lectureSeqs: autoResult.lectureSeqs,
        },
      });

    return {
      type: "AUTOLEARN",
      mode: autoResult.mode,
      processedTaskCount: autoResult.processedTaskCount,
      elapsedSeconds: autoResult.elapsedSeconds,
      plannedTaskCount: autoResult.plannedTaskCount,
      noOpReason: autoResult.noOpReason,
      planned: autoResult.planned,
      truncated: autoResult.truncated,
      estimatedTotalSeconds: autoResult.estimatedTotalSeconds,
      lectureSeqs: autoResult.lectureSeqs,
      chainSegment: options?.chainSegment ?? 1,
    };
  } catch (error) {
    let message = errMessage(error);
    if ((message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR) && stallDetected) {
      message = AUTOLEARN_STALLED_ERROR;
    }
    const isCancelled = message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR;
    const isStalled = message === AUTOLEARN_STALLED_ERROR;

    if (!isCancelled) {
      console.error(formatAutoLearnFailureLog({
        jobId,
        provider: targetProvider,
        mode,
        lectureSeq: lectureSeq ?? null,
        chainSegment: options?.chainSegment,
        error: message,
        stalled: isStalled,
      }));
      if (
        targetProvider === "CYBER_CAMPUS"
        && (message === "CYBER_CAMPUS_SESSION_INVALID"
          || message === "CYBER_CAMPUS_SESSION_REQUIRED"
          || message === "CYBER_CAMPUS_SECONDARY_AUTH_REQUIRED")
      ) {
        await invalidatePortalSession(userId, "CYBER_CAMPUS");
      }
      await recordLearningRun(userId, targetProvider, lectureSeq ?? null, "FAILED", message);
      await writeAuditLog({
        category: "WORKER",
        severity: "ERROR",
        targetUserId: userId,
        message: "AUTOLEARN job failed",
        meta: {
          jobId,
          provider: targetProvider,
          mode,
          lectureSeq: lectureSeq ?? null,
          error: message,
          stalled: isStalled,
          lastHeartbeatAt,
          stallTimeoutSeconds: env.AUTOLEARN_STALL_TIMEOUT_SECONDS,
        },
      });
    } else {
      await writeAuditLog({
        category: "WORKER",
        severity: "INFO",
        targetUserId: userId,
        message: "AUTOLEARN job cancelled",
        meta: {
          jobId,
          provider: targetProvider,
          mode,
          lectureSeq: lectureSeq ?? null,
        },
      });
    }

    throw message === errMessage(error) ? error : new Error(message);
  } finally {
    clearInterval(stallWatchdog);
    await browser.close();
  }
}

async function processDigestMail(userId: string) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled || !pref.digestEnabled) {
    return { type: "MAIL_DIGEST", userId, sent: false, reason: "DIGEST_DISABLED" };
  }

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dueSoonUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    summary,
    unreadNotices,
    unreadNotifications,
    unreadMessages,
    pendingTaskCount,
    recentNotices,
    recentNotifications,
    recentMessages,
    dueSoonTasks,
  ] = await Promise.all([
    prisma.courseSnapshot.aggregate({
      where: { userId, status: "ACTIVE" },
      _count: { _all: true },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.notificationEvent.count({ where: { userId, isUnread: true } }),
    prisma.portalMessage.count({ where: { userId, isRead: false } }),
    prisma.learningTask.count({ where: { userId, state: "PENDING" } }),
    prisma.courseNotice.findMany({
      where: { userId, createdAt: { gte: last24h } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        provider: true,
        lectureSeq: true,
        title: true,
        author: true,
        postedAt: true,
        bodyText: true,
        createdAt: true,
      },
    }),
    prisma.notificationEvent.findMany({
      where: { userId, createdAt: { gte: last24h } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        provider: true,
        courseTitle: true,
        category: true,
        message: true,
        occurredAt: true,
        createdAt: true,
        isUnread: true,
        isCanceled: true,
      },
    }),
    prisma.portalMessage.findMany({
      where: { userId, createdAt: { gte: last24h } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: {
        provider: true,
        title: true,
        senderName: true,
        sentAt: true,
        createdAt: true,
        isRead: true,
      },
    }),
    prisma.learningTask.findMany({
      where: {
        userId,
        state: "PENDING",
        dueAt: { gte: now, lte: dueSoonUntil },
      },
      orderBy: { dueAt: "asc" },
      take: 24,
      select: {
        provider: true,
        lectureSeq: true,
        weekNo: true,
        lessonNo: true,
        dueAt: true,
      },
    }),
  ]);

  const lectureSeqs = Array.from(
    new Set([
      ...recentNotices.map((notice) => notice.lectureSeq),
      ...dueSoonTasks.map((task) => task.lectureSeq),
    ]),
  );

  const titleRows = lectureSeqs.length > 0
    ? await prisma.courseSnapshot.findMany({
      where: { userId, lectureSeq: { in: lectureSeqs } },
      select: { lectureSeq: true, title: true },
    })
    : [];

  const titleBySeq = new Map(titleRows.map((row) => [row.lectureSeq, row.title]));
  const mailDocument = buildDigestMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: now,
    activeCourseCount: summary._count._all,
    avgProgress: summary._avg.progressPercent ?? 0,
    unreadNoticeCount: unreadNotices,
    unreadNotificationCount: unreadNotifications,
    unreadMessageCount: unreadMessages,
    pendingTaskCount,
    recentNotices: recentNotices.map((notice) => ({
      ...notice,
      courseTitle: titleBySeq.get(notice.lectureSeq) ?? `강좌 ${notice.lectureSeq}`,
    })),
    recentNotifications,
    recentMessages,
    dueSoonTasks: dueSoonTasks.map((task) => ({
      ...task,
      courseTitle: titleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`,
    })),
  });
  if (!mailDocument) {
    return { type: "MAIL_DIGEST", userId, sent: false, reason: "NO_MEANINGFUL_CONTENT" };
  }

  try {
    const result = await sendMail(pref.email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Digest mail sent",
        meta: { to: pref.email, subject: mailDocument.subject },
      });
      return { type: "MAIL_DIGEST", userId, sent: true };
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Digest mail skipped",
      meta: { to: pref.email, subject: mailDocument.subject, reason },
    });
    return { type: "MAIL_DIGEST", userId, sent: false, reason };
  } catch (error) {
    await recordMailDelivery(userId, pref.email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Digest mail failed",
      meta: { to: pref.email, subject: mailDocument.subject, error: errMessage(error) },
    });
    throw error;
  }
}

async function processPolicyUpdateMail(payload: PolicyUpdateMailPayload) {
  const email = await getMandatoryMailRecipient(payload.userId);
  if (!email) {
    await recordMailDelivery(
      payload.userId,
      "missing-mail-subscription@example.invalid",
      "[CU12] 약관 업데이트 안내",
      "SKIPPED",
      "MAIL_SUBSCRIPTION_EMAIL_MISSING",
    );
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: payload.userId,
      message: "Policy update mail skipped",
      meta: {
        reason: "MAIL_SUBSCRIPTION_EMAIL_MISSING",
      },
    });
    return {
      type: "MAIL_DIGEST",
      userId: payload.userId,
      sent: false,
      reason: "MAIL_SUBSCRIPTION_EMAIL_MISSING",
      mailKind: payload.mailKind,
    };
  }

  const mailDocument = buildPolicyUpdateMail({
    dashboardBaseUrl: getEnv().WEB_INTERNAL_BASE_URL,
    generatedAt: new Date(),
    changes: payload.policyChanges.map((change) => ({
      title: change.title,
      currentVersion: change.currentVersion,
      previousVersion: change.previousVersion,
      currentUrl: `${getEnv().WEB_INTERNAL_BASE_URL.replace(/\/+$/, "")}${change.currentPath}`,
      previousUrl: change.previousPath
        ? `${getEnv().WEB_INTERNAL_BASE_URL.replace(/\/+$/, "")}${change.previousPath}`
        : null,
      diffUrl: change.diffPath
        ? `${getEnv().WEB_INTERNAL_BASE_URL.replace(/\/+$/, "")}${change.diffPath}`
        : null,
    })),
  });
  if (!mailDocument) {
    return {
      type: "MAIL_DIGEST",
      userId: payload.userId,
      sent: false,
      reason: "NO_POLICY_CHANGES",
      mailKind: payload.mailKind,
    };
  }

  try {
    const result = await sendMail(email, mailDocument.subject, mailDocument.html);
    if (result.sent) {
      await recordMailDelivery(payload.userId, email, mailDocument.subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: payload.userId,
        message: "Policy update mail sent",
        meta: { to: email, subject: mailDocument.subject },
      });
      return {
        type: "MAIL_DIGEST",
        userId: payload.userId,
        sent: true,
        mailKind: payload.mailKind,
      };
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(payload.userId, email, mailDocument.subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: payload.userId,
      message: "Policy update mail skipped",
      meta: { to: email, subject: mailDocument.subject, reason },
    });
    return {
      type: "MAIL_DIGEST",
      userId: payload.userId,
      sent: false,
      reason,
      mailKind: payload.mailKind,
    };
  } catch (error) {
    await recordMailDelivery(payload.userId, email, mailDocument.subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: payload.userId,
      message: "Policy update mail failed",
      meta: { to: email, subject: mailDocument.subject, error: errMessage(error) },
    });
    throw error;
  }
}

async function processMailJob(userId: string, payload: unknown) {
  if (isPolicyUpdateMailPayload(payload)) {
    return processPolicyUpdateMail(payload);
  }

  return processDigestMail(userId);
}

async function main() {
  const env = getEnv();
  const args = parseArgs();
  const approvalId = args.get("approvalId");
  if (approvalId) {
    const result = await processCyberCampusApproval(approvalId);
    console.log(JSON.stringify(result));
    return;
  }

  const once = process.argv.includes("--once");
  const onceGraceMs = env.WORKER_ONCE_IDLE_GRACE_MS;
  let onceNoJobDeadline = once ? Date.now() + onceGraceMs : null;
  const jobTypes = parseJobTypes(args.get("types"));
  const targetUserId = args.get("userId");
  const workerId = env.WORKER_ID ?? `worker-${process.pid}`;
  const heartbeat = startHeartbeatLoop(workerId, env.POLL_INTERVAL_MS);
  const handoffTrigger = once ? resolveHandoffTrigger(jobTypes) : null;
  let shouldCheckHandoff = false;

  try {
    while (true) {
      try {
        const job = await claimJob(workerId, jobTypes, targetUserId);

        if (!job) {
          if (once) {
            const deadline = onceNoJobDeadline ?? 0;
            if (Date.now() >= deadline) {
              shouldCheckHandoff = true;
              break;
            }
            await sleep(Math.min(Math.max(2_000, Math.floor(env.POLL_INTERVAL_MS / 6)), 5_000));
            continue;
          }
          await sleep(env.POLL_INTERVAL_MS);
          continue;
        }

        try {
          const currentStatus = await getJobStatus(job.id);
          if (currentStatus !== JobStatus.RUNNING) {
            continue;
          }

          let result: unknown;
          if (job.type === JobType.SYNC || job.type === JobType.NOTICE_SCAN) {
            const shouldCancel = async () => {
              const status = await getJobStatus(job.id);
              return status === null || status === JobStatus.CANCELED;
            };
            result = await processSync(
              job.id,
              workerId,
              job.payload.userId,
              job.type,
              shouldCancel,
              {
                provider:
                  job.payload.provider === "CYBER_CAMPUS"
                    ? "CYBER_CAMPUS"
                    : job.payload.provider === "CU12"
                      ? "CU12"
                      : undefined,
              },
            );
          } else if (job.type === JobType.AUTOLEARN) {
            const shouldCancel = async () => {
              const status = await getJobStatus(job.id);
              return status === null || status === JobStatus.CANCELED;
            };
            const mode = toAutoLearnMode(job.payload.autoLearnMode);
            const chainSegment = toChainSegment(job.payload.chainSegment, 1);
            const shouldSendStartMail = chainSegment <= 1 && job.attempts <= 1;
            result = await processAutolearn(
              job.id,
              workerId,
              job.payload.userId,
              mode,
              job.payload.lectureSeq,
              shouldCancel,
              {
                chainSegment,
                sendStartMail: shouldSendStartMail,
                provider:
                  job.payload.provider === "CYBER_CAMPUS"
                    ? "CYBER_CAMPUS"
                    : job.payload.provider === "CU12"
                      ? "CU12"
                      : undefined,
              },
            );
          } else {
            result = await processMailJob(job.payload.userId, job.payload);
          }

          const terminalStatus = await getJobStatus(job.id);
          if (terminalStatus !== JobStatus.RUNNING) {
            continue;
          }

          const finished = await finishJob(job.id, workerId, result);
          if (job.type === JobType.AUTOLEARN && isAutoLearnJobResultPayload(result)) {
            const continuationQueued = finished.autoLearn?.continuationQueued === true;
            if (!continuationQueued) {
              await sendAutoLearnResultMail(job.payload.userId, {
                mode: result.mode,
                processedTaskCount: result.processedTaskCount,
                elapsedSeconds: result.elapsedSeconds,
                watchedTaskCount: result.processedTaskCount,
                watchedSeconds: result.elapsedSeconds,
                plannedTaskCount: result.plannedTaskCount,
                truncated: result.truncated,
                continuationQueued,
                chainLimitReached: finished.autoLearn?.chainLimitReached === true,
                chainSegment: finished.autoLearn?.chainSegment ?? result.chainSegment,
                estimatedTotalSeconds: result.estimatedTotalSeconds,
                noOpReason: result.noOpReason,
                planned: result.planned,
              });
            }
          }
          if (once) {
            if (job.type === JobType.AUTOLEARN) {
              shouldCheckHandoff = true;
              break;
            }
            onceNoJobDeadline = Date.now() + onceGraceMs;
          }
        } catch (jobError) {
          const message = errMessage(jobError);
          const terminalStatus = await getJobStatus(job.id);
          if (message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR || terminalStatus === JobStatus.CANCELED) {
            if (job.type === JobType.AUTOLEARN) {
              await sendAutoLearnTerminalMail(job.payload.userId, {
                status: "CANCELED",
                mode: toAutoLearnMode(job.payload.autoLearnMode),
                lectureSeq: job.payload.lectureSeq,
                chainSegment: toChainSegment(job.payload.chainSegment, 1),
                reason: message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR ? null : message,
              });
            }
            if (once) {
              break;
            }
            continue;
          }
          const failed = await failJob(job.id, workerId, message);
          if (job.type === JobType.AUTOLEARN && failed.status === JobStatus.FAILED && !failed.retryQueued) {
            await sendAutoLearnTerminalMail(job.payload.userId, {
              status: "FAILED",
              mode: toAutoLearnMode(job.payload.autoLearnMode),
              lectureSeq: job.payload.lectureSeq,
              chainSegment: toChainSegment(job.payload.chainSegment, 1),
              reason: message,
            });
          }
          if (once) {
            if (job.type === JobType.AUTOLEARN) {
              shouldCheckHandoff = true;
              break;
            }
            onceNoJobDeadline = Date.now() + onceGraceMs;
          }
        }
      } catch (loopError) {
        if (once) {
          throw loopError;
        }
        await sleep(env.POLL_INTERVAL_MS);
      }
    }
  } finally {
    heartbeat.stop();

    if (once && shouldCheckHandoff && handoffTrigger) {
      try {
        const pendingTypes = handoffTrigger === "autolearn"
          ? [JobType.AUTOLEARN]
          : [JobType.SYNC, JobType.NOTICE_SCAN];
        const pending = await hasPendingJobs(pendingTypes);
        if (pending) {
          const dispatch = await requestWorkerDispatch(handoffTrigger);
          console.log(`[WORKER] handoff trigger=${handoffTrigger} state=${dispatch.state}`);
        }
      } catch (error) {
        console.warn(`[WORKER] handoff dispatch failed: ${errMessage(error)}`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

