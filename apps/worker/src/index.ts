import { JobType, Prisma } from "@prisma/client";
import { chromium } from "playwright";
import { claimJob, failJob, finishJob, progressJob, sendHeartbeat } from "./internal-api";
import { collectCu12Snapshot, runAutoLearning, type AutoLearnMode, type AutoLearnProgress } from "./cu12-automation";
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
    return `${hour}시간 ${minute}분`;
  }
  if (minute > 0) {
    return `${minute}분 ${sec}초`;
  }
  return `${sec}초`;
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
    });
  } catch {
    // progress update must not break the main worker flow
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
    lines.push(`- 신규 공지 ${summary.newNoticeCount}건이 추가되었습니다.`);
  }

  if (pref.alertOnNotice && summary.newUnreadNotificationCount > 0) {
    lines.push(`- 읽지 않은 새 알림 ${summary.newUnreadNotificationCount}건이 있습니다.`);
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
        `  · ${task.courseTitle} ${task.weekNo}주차 ${task.lessonNo}차시 (D-${daysLeft}, ${dueAt.toLocaleString("ko-KR")})`,
      );
    }

    if (deadlineLines.length > 0) {
      lines.push("- 차시 마감 임박:");
      lines.push(...deadlineLines.slice(0, 10));
    }
  }

  if (lines.length === 0) {
    return;
  }

  const subject = "[CU12] 공지/마감 알림";
  const text = [
    "동기화 결과 알림입니다.",
    "",
    ...lines,
    "",
    "대시보드에서 상세 내용을 확인하세요.",
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

  const subject = "[CU12] 자동수강 실행 결과";
  const text = [
    "자동수강 작업이 완료되었습니다.",
    "",
    `- 실행 모드: ${payload.mode}`,
    `- 처리된 차시: ${payload.watchedTaskCount}/${payload.plannedTaskCount}`,
    `- 재생 시간: ${formatDuration(payload.watchedSeconds)}`,
    payload.truncated ? "- 안내: 안전 제한값(AUTOLEARN_MAX_TASKS)으로 일부 차시는 다음 실행에서 처리됩니다." : "",
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

async function processSync(jobId: string, userId: string) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const snapshot = await collectCu12Snapshot(browser, userId, creds);
    const persisted = await persistSnapshot(userId, snapshot);
    await markAccountConnected(userId);

    const courseTitleBySeq = new Map(snapshot.courses.map((course) => [course.lectureSeq, course.title]));

    await sendSyncAlertMail(userId, {
      newNoticeCount: persisted.newNoticeCount,
      newUnreadNotificationCount: persisted.newUnreadNotificationCount,
      deadlineTasks: persisted.deadlineTasks.map((task) => ({
        ...task,
        courseTitle: courseTitleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`,
      })),
    });

    await writeAuditLog({
      category: "WORKER",
      severity: "INFO",
      targetUserId: userId,
      message: "SYNC job completed",
      meta: {
        jobId,
        courseCount: snapshot.courses.length,
        noticeCount: snapshot.notices.length,
        taskCount: snapshot.tasks.length,
      },
    });

    return {
      type: "SYNC",
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
    await writeAuditLog({
      category: "WORKER",
      severity: "ERROR",
      targetUserId: userId,
      message: "SYNC job failed",
      meta: {
        jobId,
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
) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const autoResult = await runAutoLearning(
      browser,
      userId,
      creds,
      { mode, lectureSeq },
      async (progress) => {
        await reportJobProgress(jobId, progress);
      },
    );

    await recordLearningRun(userId, lectureSeq ?? null, "SUCCESS", `mode=${mode}, watched=${autoResult.watchedTaskCount}`);

    // Refresh snapshots after playback updates.
    const snapshot = await collectCu12Snapshot(browser, userId, creds);
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
    await recordLearningRun(userId, lectureSeq ?? null, "FAILED", errMessage(error));
    await writeAuditLog({
      category: "WORKER",
      severity: "ERROR",
      targetUserId: userId,
      message: "AUTOLEARN job failed",
      meta: {
        jobId,
        lectureSeq: lectureSeq ?? null,
        error: errMessage(error),
      },
    });
    throw error;
  } finally {
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

  const subject = "[CU12] 일일 학습 요약";
  const lines: string[] = [
    "오늘의 CU12 요약입니다.",
    "",
    `- 진행 중 강좌: ${summary._count._all}개`,
    `- 평균 진도율: ${Math.round(summary._avg.progressPercent ?? 0)}%`,
    `- 읽지 않은 공지: ${unreadNotices}건`,
    `- 읽지 않은 알림: ${unreadNotifications}건`,
  ];

  if (dueSoonTasks.length > 0) {
    lines.push("", "마감 임박 차시");
    for (const task of dueSoonTasks) {
      const title = titleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`;
      lines.push(`- ${title} ${task.weekNo}주차 ${task.lessonNo}차시 (${task.dueAt?.toLocaleString("ko-KR") ?? "-"})`);
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
  const jobTypes = parseJobTypes(args.get("types"));
  const workerId = env.WORKER_ID ?? `worker-${process.pid}`;

  while (true) {
    try {
      await sendHeartbeat(workerId);
      const job = await claimJob(workerId, jobTypes);

      if (!job) {
        if (once) break;
        await sleep(env.POLL_INTERVAL_MS);
        continue;
      }

      try {
        let result: unknown;
        if (job.type === JobType.SYNC || job.type === JobType.NOTICE_SCAN) {
          result = await processSync(job.id, job.payload.userId);
        } else if (job.type === JobType.AUTOLEARN) {
          const mode = toAutoLearnMode(job.payload.autoLearnMode);
          result = await processAutolearn(job.id, job.payload.userId, mode, job.payload.lectureSeq);
        } else {
          result = await processMailDigest(job.payload.userId);
        }

        await finishJob(job.id, result);
      } catch (jobError) {
        await failJob(job.id, errMessage(jobError));
      }
    } catch (loopError) {
      if (once) {
        throw loopError;
      }
      await sleep(env.POLL_INTERVAL_MS);
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

