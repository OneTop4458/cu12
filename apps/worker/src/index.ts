import { JobStatus, JobType, Prisma } from "@prisma/client";
import { chromium } from "playwright";
import { claimJob, failJob, finishJob, progressJob, sendHeartbeat } from "./internal-api";
import {
  collectCu12Snapshot,
  runAutoLearning,
  type AutoLearnMode,
  type AutoLearnProgress,
  type SyncProgress,
} from "./cu12-automation";
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

async function reportJobProgress(jobId: string, progress: AutoLearnProgress) {
  try {
    await progressJob(jobId, {
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

async function reportSyncJobProgress(jobId: string, progress: SyncProgress) {
  try {
    await progressJob(jobId, {
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

  const lines: string[] = [];
  if (pref.alertOnNotice && summary.newNoticeCount > 0) {
    lines.push(`- ?좉퇋 怨듭? ${summary.newNoticeCount}嫄댁씠 異붽??섏뿀?듬땲??`);
  }

  if (pref.alertOnNotice && summary.newUnreadNotificationCount > 0) {
    lines.push(`- ?쎌? ?딆? ???뚮┝ ${summary.newUnreadNotificationCount}嫄댁씠 ?덉뒿?덈떎.`);
  }

  if (pref.alertOnDeadline && summary.deadlineTasks.length > 0) {
    const now = new Date();
    const thresholdSet = new Set([7, 3, 1, 0]);
    const deadlineLines: string[] = [];

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

      deadlineLines.push(
        `  쨌 ${task.courseTitle} ${task.weekNo}二쇱감 ${task.lessonNo}李⑥떆 (D-${daysLeft}, ${dueAt.toLocaleString("ko-KR")})`,
      );
    }

    if (deadlineLines.length > 0) {
      lines.push("- 李⑥떆 留덇컧 ?꾨컯:");
      lines.push(...deadlineLines.slice(0, 10));
    }
  }

  if (lines.length === 0) {
    return;
  }

  const subject = "[CU12] 怨듭?/留덇컧 ?뚮┝";
  const text = [
    "?숆린??寃곌낵 ?뚮┝?낅땲??",
    "",
    ...lines,
    "",
    "??쒕낫?쒖뿉???곸꽭 ?댁슜???뺤씤?섏꽭??",
  ].join("\n");

  try {
    const result = await sendMail(pref.email, subject, text);
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

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Sync alert mail skipped",
      meta: { to: pref.email, subject, reason: result.reason },
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
  },
) {
  const pref = await getUserMailPreference(userId);
  if (!pref || !pref.enabled || !pref.alertOnAutolearn) {
    return;
  }

  const subject = "[CU12] ?먮룞?섍컯 ?ㅽ뻾 寃곌낵";
  const text = [
    "?먮룞?섍컯 ?묒뾽???꾨즺?섏뿀?듬땲??",
    "",
    `- ?ㅽ뻾 紐⑤뱶: ${payload.mode}`,
    `- 泥섎━??李⑥떆: ${payload.watchedTaskCount}/${payload.plannedTaskCount}`,
    `- ?ъ깮 ?쒓컙: ${formatDuration(payload.watchedSeconds)}`,
    payload.truncated ? "- ?덈궡: ?덉쟾 ?쒗븳媛?AUTOLEARN_MAX_TASKS)?쇰줈 ?쇰? 李⑥떆???ㅼ쓬 ?ㅽ뻾?먯꽌 泥섎━?⑸땲??" : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  try {
    const result = await sendMail(pref.email, subject, text);
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

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Autolearn result mail skipped",
      meta: { to: pref.email, subject, reason: result.reason },
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

  const env = getEnv();
  const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
  const shouldCancel = onCancelCheck ?? (async () => false);
  const startedAtMs = Date.now();
  let lastProgressLogKey = "";
  console.log(`${logPrefix} started job=${jobId} user=${userId}`);
  try {
    const snapshot = await collectCu12Snapshot(
      browser,
      userId,
      creds,
      shouldCancel,
      async (progress) => {
        await reportSyncJobProgress(jobId, progress);
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
  } finally {
    await browser.close();
  }
}

async function processAutolearn(
  jobId: string,
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
        await reportJobProgress(jobId, progress);
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
        plannedTaskCount: autoResult.plannedTaskCount,
      },
    });

    return {
      type: "AUTOLEARN",
      mode: autoResult.mode,
      watchedTaskCount: autoResult.watchedTaskCount,
      watchedSeconds: autoResult.watchedSeconds,
      plannedTaskCount: autoResult.plannedTaskCount,
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
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [summary, unreadNotices, unreadNotifications, dueSoonTasks] = await Promise.all([
    prisma.courseSnapshot.aggregate({
      where: { userId, status: "ACTIVE" },
      _count: { _all: true },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.notificationEvent.count({ where: { userId, isUnread: true } }),
    prisma.learningTask.findMany({
      where: {
        userId,
        state: "PENDING",
        dueAt: { gte: now, lte: soon },
      },
      orderBy: { dueAt: "asc" },
      take: 5,
      select: { lectureSeq: true, weekNo: true, lessonNo: true, dueAt: true },
    }),
  ]);

  const titleRows = dueSoonTasks.length > 0
    ? await prisma.courseSnapshot.findMany({
      where: {
        userId,
        lectureSeq: { in: Array.from(new Set(dueSoonTasks.map((task) => task.lectureSeq))) },
      },
      select: { lectureSeq: true, title: true },
    })
    : [];
  const titleBySeq = new Map(titleRows.map((row) => [row.lectureSeq, row.title]));

  const subject = "[CU12] Weekly digest";
  const lines: string[] = [
    "CU12 digest generated",
    "",
    `- Active courses: ${summary._count._all}`,
    `- Average progress: ${Math.round(summary._avg.progressPercent ?? 0)}%`,
    `- Unread notices: ${unreadNotices}`,
    `- Unread notifications: ${unreadNotifications}`,
  ];

  if (dueSoonTasks.length > 0) {
    lines.push("", "留덇컧 ?꾨컯 李⑥떆");
    for (const task of dueSoonTasks) {
      const title = titleBySeq.get(task.lectureSeq) ?? `媛뺤쥖 ${task.lectureSeq}`;
      lines.push(`- ${title} ${task.weekNo}二쇱감 ${task.lessonNo}李⑥떆 (${task.dueAt?.toLocaleString("ko-KR") ?? "-"})`);
    }
  }

  try {
    const result = await sendMail(pref.email, subject, lines.join("\n"));
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

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
    await writeAuditLog({
      category: "MAIL",
      severity: "WARN",
      targetUserId: userId,
      message: "Digest mail skipped",
      meta: { to: pref.email, subject, reason: result.reason },
    });
    return { type: "MAIL_DIGEST", userId, sent: false, reason: result.reason };
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

  try {
    while (true) {
      try {
        const job = await claimJob(workerId, jobTypes);

        if (!job) {
          if (once) {
            const deadline = onceNoJobDeadline ?? 0;
            if (Date.now() >= deadline) break;
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
          result = await processSync(job.id, job.payload.userId, job.type, shouldCancel);
        } else if (job.type === JobType.AUTOLEARN) {
          const shouldCancel = async () => {
            const status = await getJobStatus(job.id);
            return status === null || status === JobStatus.CANCELED;
          };
          const mode = toAutoLearnMode(job.payload.autoLearnMode);
          result = await processAutolearn(
            job.id,
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

          await finishJob(job.id, result);
          if (once) {
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
          await failJob(job.id, message);
          if (once) {
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

