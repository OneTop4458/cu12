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
} from "./cu12-automation";
import { collectCu12SnapshotViaHttp } from "./cu12-http-sync";
import { getEnv } from "./env";
import {
  getUserCu12Credentials,
  getUserMailPreference,
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
    return `${hour}h ${minute}m ${sec}s`;
  }
  if (minute > 0) {
    return `${minute}m ${sec}s`;
  }
  return `${sec}s`;
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
    ${hiddenCount > 0 ? `<p style="margin:8px 0 0;color:#6b7280;">${hiddenCount} more items are omitted. Open the dashboard for the full list.</p>` : ""}
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
        <p style="margin:18px 0 0;color:#6b7280;font-size:12px;">This mail is generated by the CU12 automation worker.</p>
      </article>
    </div>
  </body>
</html>`;
}

function formatAutoLearnModeLabel(mode: AutoLearnMode): string {
  if (mode === "SINGLE_NEXT") return "Selected course: next lesson";
  if (mode === "SINGLE_ALL") return "Selected course: all lessons";
  return "All active courses";
}

function formatAutoLearnNoOpReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "NO_ACTIVE_COURSES") return "No active course was found.";
  if (reason === "LECTURE_NOT_FOUND") return "The selected lecture was not found.";
  if (reason === "NO_PENDING_TASKS") return "There are no pending lessons.";
  if (reason === "NO_PENDING_VOD_TASKS") return "There are no pending VOD lessons.";
  if (reason === "NO_AVAILABLE_VOD_TASKS") return "No VOD lesson is available in the allowed window.";
  if (reason === "NO_TASKS_AFTER_FILTER") return "No lesson remained after filter application.";
  return reason;
}
function toAutoLearnMode(raw: unknown): AutoLearnMode {
  if (raw === "SINGLE_NEXT" || raw === "SINGLE_ALL" || raw === "ALL_COURSES") {
    return raw;
  }
  return "ALL_COURSES";
}

function parseArgs() {
  const map = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k && v) map.set(k, v);
  }
  return map;
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
  summary: {
    newNoticeCount: number;
    newUnreadNotificationCount: number;
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

  const hasNoticeAlert = pref.alertOnNotice
    && (summary.newNoticeCount > 0 || summary.newUnreadNotificationCount > 0);
  const hasDeadlineAlert = pref.alertOnDeadline && deadlineAlerts.length > 0;

  if (!hasNoticeAlert && !hasDeadlineAlert) {
    return;
  }

  const sections: string[] = [];

  if (pref.alertOnNotice) {
    const noticeSummary = `
      <p style="margin:0;color:#111827;">New notices: <strong>${summary.newNoticeCount}</strong>, new unread notifications: <strong>${summary.newUnreadNotificationCount}</strong>.</p>
    `;

    sections.push(
      renderMailSection(
        "Notice/Notification Summary",
        noticeSummary,
        { href: buildDashboardLink(DASHBOARD_SECTION_ID.NOTIFICATIONS), label: "Open notices and notifications" },
      ),
    );

    if (summary.newNotices.length > 0) {
      const noticeItems = summary.newNotices.map((notice) => `
        <li style="margin:0 0 8px;">
          <p style="margin:0 0 2px;"><strong>${escapeHtml(notice.title)}</strong></p>
          <p style="margin:0 0 2px;color:#4b5563;">${escapeHtml(notice.courseTitle)} | author ${escapeHtml(notice.author ?? "-")} | posted ${escapeHtml(formatKoDateTime(notice.postedAt))}</p>
          <p style="margin:0;color:#111827;">${escapeHtml(toSnippet(notice.bodyText, 160))}</p>
        </li>
      `);

      sections.push(
        renderMailSection(
          "New Notices",
          renderMailList(noticeItems, 8),
          { href: buildDashboardLink(DASHBOARD_SECTION_ID.NOTIFICATIONS), label: "View all notices" },
        ),
      );
    }

    if (summary.newUnreadNotifications.length > 0) {
      const notificationItems = summary.newUnreadNotifications.map((event) => `
        <li style="margin:0 0 8px;">
          <p style="margin:0 0 2px;"><strong>${escapeHtml(event.courseTitle)}</strong> | ${escapeHtml(event.category)}</p>
          <p style="margin:0 0 2px;color:#4b5563;">${escapeHtml(formatKoDateTime(event.occurredAt))}</p>
          <p style="margin:0;color:#111827;">${escapeHtml(toSnippet(event.message, 140))}</p>
        </li>
      `);

      sections.push(
        renderMailSection(
          "New Unread Notifications",
          renderMailList(notificationItems, 10),
          { href: buildDashboardLink(DASHBOARD_SECTION_ID.NOTIFICATIONS), label: "Open notification center" },
        ),
      );
    }
  }

  if (hasDeadlineAlert) {
    const deadlineItems = deadlineAlerts.map((task) => `
      <li style="margin:0 0 8px;">
        <p style="margin:0 0 2px;"><strong>${escapeHtml(task.courseTitle)}</strong> week ${task.weekNo}, lesson ${task.lessonNo}</p>
        <p style="margin:0;color:#4b5563;">D-${task.daysLeft} | due ${escapeHtml(formatKoDateTime(task.dueAt))}</p>
      </li>
    `);

    sections.push(
      renderMailSection(
        "Upcoming Deadlines",
        renderMailList(deadlineItems, 10),
        { href: buildDashboardLink(DASHBOARD_SECTION_ID.DEADLINES), label: "Open deadline list" },
      ),
    );
  }

  const subject = "[CU12] Sync Alert";
  const html = renderMailLayout({
    title: "Sync Alert Report",
    subtitle: "New notices, unread notifications, and deadline alerts from the latest sync.",
    summaryRows: [
      { label: "Generated at", value: formatKoDateTime(new Date()) },
      { label: "New notices", value: `${summary.newNoticeCount} items` },
      { label: "New unread notifications", value: `${summary.newUnreadNotificationCount} items` },
      { label: "Deadline alerts", value: `${deadlineAlerts.length} items` },
    ],
    sections,
    primaryLink: { href: buildDashboardLink(DASHBOARD_SECTION_ID.OVERVIEW), label: "Open dashboard" },
  });

  try {
    const result = await sendMail(pref.email, subject, html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Sync alert mail sent",
        meta: { to: pref.email, subject },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Sync alert mail skipped",
      meta: { to: pref.email, subject, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Sync alert mail failed",
      meta: { to: pref.email, subject, error: errMessage(error) },
    });
  }
}

async function sendAutoLearnResultMail(
  userId: string,
  payload: {
    mode: AutoLearnMode;
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

  const noOpReasonLabel = formatAutoLearnNoOpReason(payload.noOpReason);
  const plannedRows = payload.planned ?? [];
  const notes: string[] = [];

  if (typeof payload.chainSegment === "number" && Number.isFinite(payload.chainSegment)) {
    notes.push(`Chain segment: ${payload.chainSegment}`);
  }
  if (payload.truncated) {
    notes.push("This run was truncated by chunk limits.");
  }
  if (payload.continuationQueued) {
    notes.push("The next auto-learn chunk was queued automatically.");
  }
  if (payload.chainLimitReached) {
    notes.push("Continuation was stopped because chain limit was reached.");
  }
  if (noOpReasonLabel) {
    notes.push(`No-op reason: ${noOpReasonLabel}`);
  }

  const sections: string[] = [];

  sections.push(
    renderMailSection(
      "Run Summary",
      `
        <p style="margin:0 0 6px;color:#111827;">Mode: <strong>${escapeHtml(formatAutoLearnModeLabel(payload.mode))}</strong></p>
        <p style="margin:0 0 6px;color:#111827;">Completed lessons: <strong>${payload.watchedTaskCount}/${payload.plannedTaskCount}</strong> (${toPercent(payload.watchedTaskCount, Math.max(1, payload.plannedTaskCount))})</p>
        <p style="margin:0 0 6px;color:#111827;">Watched time: <strong>${escapeHtml(formatDuration(payload.watchedSeconds))}</strong></p>
        <p style="margin:0;color:#111827;">Estimated total: <strong>${escapeHtml(formatDuration(payload.estimatedTotalSeconds))}</strong></p>
      `,
      { href: buildDashboardLink(DASHBOARD_SECTION_ID.JOBS), label: "Open job status" },
    ),
  );

  if (notes.length > 0) {
    const noteItems = notes.map((note) => `<li style="margin:0 0 6px;color:#111827;">${escapeHtml(note)}</li>`);
    sections.push(renderMailSection("Notes", renderMailList(noteItems, 8)));
  }

  if (plannedRows.length > 0) {
    const plannedItems = plannedRows.map((row) => {
      const remainingSeconds = Math.max(0, row.remainingSeconds);
      return `
        <li style="margin:0 0 8px;">
          <p style="margin:0 0 2px;"><strong>${escapeHtml(row.courseTitle)}</strong> week ${row.weekNo}, lesson ${row.lessonNo}</p>
          <p style="margin:0 0 2px;color:#4b5563;">${escapeHtml(row.taskTitle)} | remaining ${escapeHtml(formatDuration(remainingSeconds))}</p>
          <p style="margin:0;color:#4b5563;">available ${escapeHtml(formatKoDateTime(row.availableFrom))} ~ due ${escapeHtml(formatKoDateTime(row.dueAt))}</p>
        </li>
      `;
    });

    sections.push(
      renderMailSection(
        "Planned Lessons",
        renderMailList(plannedItems, 12),
        { href: buildDashboardLink(DASHBOARD_SECTION_ID.COURSES), label: "Open course status" },
      ),
    );
  }

  const subject = "[CU12] Auto-learn Result";
  const html = renderMailLayout({
    title: "Auto-learn Result",
    subtitle: "Detailed outcome for the latest auto-learn run.",
    summaryRows: [
      { label: "Generated at", value: formatKoDateTime(new Date()) },
      { label: "Mode", value: formatAutoLearnModeLabel(payload.mode) },
      { label: "Completed lessons", value: `${payload.watchedTaskCount}/${payload.plannedTaskCount}` },
      { label: "Watched time", value: formatDuration(payload.watchedSeconds) },
    ],
    sections,
    primaryLink: { href: buildDashboardLink(DASHBOARD_SECTION_ID.OVERVIEW), label: "Open dashboard" },
  });

  try {
    const result = await sendMail(pref.email, subject, html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Autolearn result mail sent",
        meta: { to: pref.email, subject },
      });
      return;
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Autolearn result mail skipped",
      meta: { to: pref.email, subject, reason },
    });
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Autolearn result mail failed",
      meta: { to: pref.email, subject, error: errMessage(error) },
    });
  }
}
async function processSync(
  jobId: string,
  workerId: string,
  userId: string,
  jobType: "SYNC" | "NOTICE_SCAN",
  onCancelCheck?: CancelCheck,
) {
  const resultType: "SYNC" | "NOTICE_SCAN" = jobType === "NOTICE_SCAN" ? "NOTICE_SCAN" : "SYNC";
  const logPrefix = `[${resultType}]`;
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

  const shouldCancel = onCancelCheck ?? (async () => false);
  const startedAtMs = Date.now();
  let lastProgressLogKey = "";
  console.log(`${logPrefix} started job=${jobId} user=${userId}`);
  try {
    const snapshot = await collectCu12SnapshotViaHttp(
      userId,
      creds,
      shouldCancel,
      async (progress) => {
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
      },
    );
    const persisted = await persistSnapshot(userId, snapshot);
    await markAccountConnected(userId);

    const courseTitleBySeq = new Map(snapshot.courses.map((course) => [course.lectureSeq, course.title]));

    await sendSyncAlertMail(userId, {
      newNoticeCount: persisted.newNoticeCount,
      newUnreadNotificationCount: persisted.newUnreadNotificationCount,
      newNotices: persisted.newNotices.map((notice) => ({
        ...notice,
        courseTitle: courseTitleBySeq.get(notice.lectureSeq) ?? `Course ${notice.lectureSeq}`,
      })),
      newUnreadNotifications: persisted.newUnreadNotifications,
      deadlineTasks: persisted.deadlineTasks.map((task) => ({
        ...task,
        courseTitle: courseTitleBySeq.get(task.lectureSeq) ?? `Course ${task.lectureSeq}`,
      })),
    });

    console.log(
      `${logPrefix} completed job=${jobId}`
      + ` courses=${snapshot.courses.length}`
      + ` notices=${snapshot.notices.length}`
      + ` tasks=${snapshot.tasks.length}`
      + ` notifications=${snapshot.notifications.length}`
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
) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

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
  try {
    const autoResult = await runAutoLearning(
      browser,
      userId,
      creds,
      { mode, lectureSeq },
      async (progress) => {
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
            + ` watched=${progress.watchedSeconds}s`
            + ` course="${courseTitle}" task="${taskTitle}"`,
          );
        }
        await reportJobProgress(jobId, workerId, progress);
      },
      async () => {
        if (stallDetected) return true;
        const externalCancel = onCancelCheck ? await onCancelCheck() : false;
        if (externalCancel) return true;
        const status = await getJobStatus(jobId);
        return status === null || status === JobStatus.CANCELED;
      },
    );
    if (stallDetected) {
      throw new Error(AUTOLEARN_STALLED_ERROR);
    }
    clearInterval(stallWatchdog);

    await recordLearningRun(userId, lectureSeq ?? null, "SUCCESS", `mode=${mode}, watched=${autoResult.watchedTaskCount}`);

    // Refresh snapshots after playback updates.
    const shouldCancel = onCancelCheck ?? (async () => false);
    const snapshot = await collectCu12Snapshot(browser, userId, creds, shouldCancel);
    await persistSnapshot(userId, snapshot);

    await sendAutoLearnResultMail(userId, {
      mode: autoResult.mode,
      watchedTaskCount: autoResult.watchedTaskCount,
      watchedSeconds: autoResult.watchedSeconds,
      plannedTaskCount: autoResult.plannedTaskCount,
      truncated: autoResult.truncated,
      continuationQueued: autoResult.continuationQueued,
      chainLimitReached: autoResult.chainLimitReached,
      chainSegment: autoResult.chainSegment,
      estimatedTotalSeconds: autoResult.estimatedTotalSeconds,
      noOpReason: autoResult.noOpReason,
      planned: autoResult.planned,
    });

    await writeAuditLog({
      category: "WORKER",
      severity: "INFO",
      targetUserId: userId,
      message: "AUTOLEARN job completed",
      meta: {
        jobId,
        mode: autoResult.mode,
        watchedTaskCount: autoResult.watchedTaskCount,
        noOpReason: autoResult.noOpReason,
        plannedTaskCount: autoResult.plannedTaskCount,
      },
    });

    return {
      type: "AUTOLEARN",
      mode: autoResult.mode,
      watchedTaskCount: autoResult.watchedTaskCount,
      watchedSeconds: autoResult.watchedSeconds,
      plannedTaskCount: autoResult.plannedTaskCount,
      noOpReason: autoResult.noOpReason,
      planned: autoResult.planned,
      truncated: autoResult.truncated,
      estimatedTotalSeconds: autoResult.estimatedTotalSeconds,
      lectureSeqs: autoResult.lectureSeqs,
    };
  } catch (error) {
    let message = errMessage(error);
    if ((message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR) && stallDetected) {
      message = AUTOLEARN_STALLED_ERROR;
    }
    const isCancelled = message === AUTOLEARN_CANCEL_ERROR || message === JOB_CANCEL_ERROR;
    const isStalled = message === AUTOLEARN_STALLED_ERROR;

    if (!isCancelled) {
      await recordLearningRun(userId, lectureSeq ?? null, "FAILED", message);
      await writeAuditLog({
        category: "WORKER",
        severity: "ERROR",
        targetUserId: userId,
        message: "AUTOLEARN job failed",
        meta: {
          jobId,
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

async function processMailDigest(userId: string) {
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
    pendingTaskCount,
    recentNotices,
    recentNotifications,
    dueSoonTasks,
  ] = await Promise.all([
    prisma.courseSnapshot.aggregate({
      where: { userId, status: "ACTIVE" },
      _count: { _all: true },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.notificationEvent.count({ where: { userId, isUnread: true } }),
    prisma.learningTask.count({ where: { userId, state: "PENDING" } }),
    prisma.courseNotice.findMany({
      where: { userId, createdAt: { gte: last24h } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
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
      take: 20,
      select: {
        courseTitle: true,
        category: true,
        message: true,
        occurredAt: true,
        createdAt: true,
        isUnread: true,
      },
    }),
    prisma.learningTask.findMany({
      where: {
        userId,
        state: "PENDING",
        dueAt: { gte: now, lte: dueSoonUntil },
      },
      orderBy: { dueAt: "asc" },
      take: 12,
      select: {
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

  const noticeItems = recentNotices.map((notice) => {
    const courseTitle = titleBySeq.get(notice.lectureSeq) ?? `Course ${notice.lectureSeq}`;
    return `
      <li style="margin:0 0 8px;">
        <p style="margin:0 0 2px;"><strong>${escapeHtml(notice.title)}</strong></p>
        <p style="margin:0 0 2px;color:#4b5563;">${escapeHtml(courseTitle)} | author ${escapeHtml(notice.author ?? "-")} | posted ${escapeHtml(formatKoDateTime(notice.postedAt))} | fetched ${escapeHtml(formatKoDateTime(notice.createdAt))}</p>
        <p style="margin:0;color:#111827;">${escapeHtml(toSnippet(notice.bodyText, 180))}</p>
      </li>
    `;
  });

  const notificationItems = recentNotifications.map((event) => {
    const occurredAt = event.occurredAt ?? event.createdAt;
    const unreadLabel = event.isUnread ? "UNREAD" : "READ";
    return `
      <li style="margin:0 0 8px;">
        <p style="margin:0 0 2px;"><strong>${escapeHtml(event.courseTitle)}</strong> | ${escapeHtml(event.category)} | ${escapeHtml(unreadLabel)}</p>
        <p style="margin:0 0 2px;color:#4b5563;">${escapeHtml(formatKoDateTime(occurredAt))}</p>
        <p style="margin:0;color:#111827;">${escapeHtml(toSnippet(event.message, 170))}</p>
      </li>
    `;
  });

  const deadlineItems = dueSoonTasks.map((task) => {
    const courseTitle = titleBySeq.get(task.lectureSeq) ?? `Course ${task.lectureSeq}`;
    const dueAt = task.dueAt;
    if (!dueAt) {
      return `
        <li style="margin:0 0 8px;">
          <p style="margin:0 0 2px;"><strong>${escapeHtml(courseTitle)}</strong> week ${task.weekNo}, lesson ${task.lessonNo}</p>
          <p style="margin:0;color:#4b5563;">due date is unavailable</p>
        </li>
      `;
    }
    const daysLeft = Math.ceil((dueAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const ddayLabel = daysLeft <= 0 ? "D-day" : `D-${daysLeft}`;
    return `
      <li style="margin:0 0 8px;">
        <p style="margin:0 0 2px;"><strong>${escapeHtml(courseTitle)}</strong> week ${task.weekNo}, lesson ${task.lessonNo}</p>
        <p style="margin:0;color:#4b5563;">${escapeHtml(ddayLabel)} | due ${escapeHtml(formatKoDateTime(dueAt))}</p>
      </li>
    `;
  });

  const sections: string[] = [];
  sections.push(
    renderMailSection(
      "24h Summary",
      `
        <p style="margin:0 0 6px;color:#111827;">New notices in last 24h: <strong>${recentNotices.length}</strong></p>
        <p style="margin:0 0 6px;color:#111827;">New notifications in last 24h: <strong>${recentNotifications.length}</strong></p>
        <p style="margin:0;color:#111827;">Deadlines within 7 days: <strong>${dueSoonTasks.length}</strong></p>
      `,
      { href: buildDashboardLink(DASHBOARD_SECTION_ID.OVERVIEW), label: "Open dashboard overview" },
    ),
  );

  sections.push(
    renderMailSection(
      "Recent Notices",
      renderMailList(noticeItems, 10),
      { href: buildDashboardLink(DASHBOARD_SECTION_ID.NOTIFICATIONS), label: "Open notices" },
    ),
  );

  sections.push(
    renderMailSection(
      "Recent Notifications",
      renderMailList(notificationItems, 10),
      { href: buildDashboardLink(DASHBOARD_SECTION_ID.NOTIFICATIONS), label: "Open notifications" },
    ),
  );

  sections.push(
    renderMailSection(
      "Upcoming Deadlines",
      renderMailList(deadlineItems, 12),
      { href: buildDashboardLink(DASHBOARD_SECTION_ID.DEADLINES), label: "Open deadlines" },
    ),
  );

  const subject = "[CU12] Daily Learning Digest";
  const html = renderMailLayout({
    title: "Daily Learning Digest",
    subtitle: "24-hour changes and upcoming deadlines.",
    summaryRows: [
      { label: "Generated at", value: formatKoDateTime(now) },
      { label: "Active courses", value: `${summary._count._all}` },
      { label: "Average progress", value: `${Math.round(summary._avg.progressPercent ?? 0)}%` },
      { label: "Unread notices", value: `${unreadNotices}` },
      { label: "Unread notifications", value: `${unreadNotifications}` },
      { label: "Pending lessons", value: `${pendingTaskCount}` },
    ],
    sections,
    primaryLink: { href: buildDashboardLink(DASHBOARD_SECTION_ID.OVERVIEW), label: "Open dashboard" },
  });

  try {
    const result = await sendMail(pref.email, subject, html);
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, subject, "SENT");
      await writeAuditLog({
        category: "MAIL",
        severity: "INFO",
        targetUserId: userId,
        message: "Digest mail sent",
        meta: { to: pref.email, subject },
      });
      return { type: "MAIL_DIGEST", userId, sent: true };
    }

    const reason = result.reason ?? "UNKNOWN_REASON";
    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Digest mail skipped",
      meta: { to: pref.email, subject, reason },
    });
    return { type: "MAIL_DIGEST", userId, sent: false, reason };
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "MAIL",
      severity: "ERROR",
      targetUserId: userId,
      message: "Digest mail failed",
      meta: { to: pref.email, subject, error: errMessage(error) },
    });
    throw error;
  }
}
async function main() {
  const env = getEnv();
  const args = parseArgs();
  const once = process.argv.includes("--once");
  const onceGraceMs = env.WORKER_ONCE_IDLE_GRACE_MS;
  let onceNoJobDeadline = once ? Date.now() + onceGraceMs : null;
  const jobTypes = parseJobTypes(args.get("types"));
  const workerId = env.WORKER_ID ?? `worker-${process.pid}`;
  const heartbeat = startHeartbeatLoop(workerId, env.POLL_INTERVAL_MS);
  const handoffTrigger = once ? resolveHandoffTrigger(jobTypes) : null;
  let shouldCheckHandoff = false;

  try {
    while (true) {
      try {
        const job = await claimJob(workerId, jobTypes);

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
          result = await processSync(job.id, workerId, job.payload.userId, job.type, shouldCancel);
        } else if (job.type === JobType.AUTOLEARN) {
          const shouldCancel = async () => {
            const status = await getJobStatus(job.id);
            return status === null || status === JobStatus.CANCELED;
          };
          const mode = toAutoLearnMode(job.payload.autoLearnMode);
          result = await processAutolearn(
            job.id,
            workerId,
            job.payload.userId,
            mode,
            job.payload.lectureSeq,
            shouldCancel,
          );
        } else {
          result = await processMailDigest(job.payload.userId);
        }

          const terminalStatus = await getJobStatus(job.id);
          if (terminalStatus !== JobStatus.RUNNING) {
            continue;
          }

          await finishJob(job.id, workerId, result);
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
            if (once) {
              break;
            }
            continue;
          }
          await failJob(job.id, workerId, message);
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

