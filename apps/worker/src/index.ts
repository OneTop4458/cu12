import { JobType } from "@prisma/client";
import { chromium } from "playwright";
import { claimJob, failJob, finishJob, progressJob, sendHeartbeat } from "./internal-api";
import { collectCu12Snapshot, runAutoLearning, type AutoLearnMode, type AutoLearnProgress } from "./cu12-automation";
import { getEnv } from "./env";
import {
  getUserCu12Credentials,
  getUserMailPreference,
  markAccountConnected,
  markAccountNeedsReauth,
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
    deadlineCourses: Array<{ title: string; remainDays: number }>;
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

  if (pref.alertOnDeadline && summary.deadlineCourses.length > 0) {
    lines.push("- 마감 임박 강좌:");
    for (const course of summary.deadlineCourses.slice(0, 5)) {
      lines.push(`  · ${course.title} (${course.remainDays}일 남음)`);
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
      return;
    }

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
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
      return;
    }

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
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

    await sendSyncAlertMail(userId, {
      newNoticeCount: persisted.newNoticeCount,
      newUnreadNotificationCount: persisted.newUnreadNotificationCount,
      deadlineCourses: persisted.deadlineCourses,
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
      deadlineCourseCount: persisted.deadlineCourses.length,
    };
  } catch (error) {
    const message = errMessage(error);
    if (/login|Unauthorized|need/i.test(message)) {
      await markAccountNeedsReauth(userId, message);
    }
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

  const [summary, unreadNotices, unreadNotifications, dueSoonCourses] = await Promise.all([
    prisma.courseSnapshot.aggregate({
      where: { userId, status: "ACTIVE" },
      _count: { _all: true },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.notificationEvent.count({ where: { userId, isUnread: true } }),
    prisma.courseSnapshot.findMany({
      where: {
        userId,
        status: "ACTIVE",
        remainDays: { lte: 3, gte: 0 },
      },
      orderBy: { remainDays: "asc" },
      take: 5,
      select: { title: true, remainDays: true },
    }),
  ]);

  const subject = "[CU12] 일일 학습 요약";
  const lines: string[] = [
    "오늘의 CU12 요약입니다.",
    "",
    `- 진행 중 강좌: ${summary._count._all}개`,
    `- 평균 진도율: ${Math.round(summary._avg.progressPercent ?? 0)}%`,
    `- 읽지 않은 공지: ${unreadNotices}건`,
    `- 읽지 않은 알림: ${unreadNotifications}건`,
  ];

  if (dueSoonCourses.length > 0) {
    lines.push("", "마감 임박 강좌");
    for (const course of dueSoonCourses) {
      lines.push(`- ${course.title} (${course.remainDays ?? "-"}일 남음)`);
    }
  }

  try {
    const result = await sendMail(pref.email, subject, lines.join("\n"));
    if (result.sent) {
      await recordMailDelivery(userId, pref.email, subject, "SENT");
      return { type: "MAIL_DIGEST", userId, sent: true };
    }

    await recordMailDelivery(userId, pref.email, subject, "SKIPPED", result.reason);
    return { type: "MAIL_DIGEST", userId, sent: false, reason: result.reason };
  } catch (error) {
    await recordMailDelivery(userId, pref.email, subject, "FAILED", errMessage(error));
    throw error;
  }
}

async function main() {
  const env = getEnv();
  const once = process.argv.includes("--once");
  const workerId = env.WORKER_ID ?? `worker-${process.pid}`;

  while (true) {
    try {
      await sendHeartbeat(workerId);
      const job = await claimJob(workerId, [JobType.SYNC, JobType.AUTOLEARN, JobType.NOTICE_SCAN, JobType.MAIL_DIGEST]);

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
