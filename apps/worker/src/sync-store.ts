import type { CourseNotice, CourseState, LearningTask, NotificationEvent } from "@cu12/core";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret } from "./secret";

function toDate(value: string | null): Date | null {
  if (!value) return null;
  if (value.includes("T")) {
    return new Date(value);
  }
  return new Date(`${value}T00:00:00+09:00`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_PRISMA_CODES = new Set(["P2028", "P1001", "P1008", "P1017"]);
const TRANSITION_ERROR_HINTS = ["Transaction API error"];

function isRetryablePrismaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return TRANSITION_ERROR_HINTS.some((hint) => error.message.includes(hint));
  }
  return false;
}

async function runWithPrismaRetry<T>(op: () => Promise<T>): Promise<T> {
  let attempts = 0;

  while (true) {
    try {
      return await op();
    } catch (error) {
      if (!isRetryablePrismaError(error) || attempts >= 2) {
        throw error;
      }

      attempts += 1;
      await sleep(300 * attempts);
    }
  }
}

export interface PersistSnapshotResult {
  newNoticeCount: number;
  newNotificationCount: number;
  newUnreadNotificationCount: number;
  deadlineTasks: Array<{
    lectureSeq: number;
    courseContentsSeq: number;
    weekNo: number;
    lessonNo: number;
    dueAt: string;
  }>;
  pendingTaskCount: number;
}

export interface MailPreference {
  enabled: boolean;
  email: string;
  alertOnNotice: boolean;
  alertOnDeadline: boolean;
  alertOnAutolearn: boolean;
  digestEnabled: boolean;
  digestHour: number;
}

export async function getUserCu12Credentials(userId: string) {
  const account = await prisma.cu12Account.findUnique({ where: { userId } });
  if (!account) return null;

  return {
    cu12Id: account.cu12Id,
    cu12Password: decryptSecret(account.encryptedPassword),
    campus: (account.campus === "SONGSIN" ? "SONGSIN" : "SONGSIM") as "SONGSIM" | "SONGSIN",
  };
}

export async function getUserMailPreference(userId: string): Promise<MailPreference | null> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  if (!user?.email) {
    return null;
  }

  if (!subscription) {
    return {
      enabled: false,
      email: user.email,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: true,
      digestHour: 8,
    };
  }

  return {
    enabled: subscription.enabled,
    email: subscription.email,
    alertOnNotice: subscription.alertOnNotice,
    alertOnDeadline: subscription.alertOnDeadline,
    alertOnAutolearn: subscription.alertOnAutolearn,
    digestEnabled: subscription.digestEnabled,
    digestHour: subscription.digestHour,
  };
}

export async function markAccountNeedsReauth(userId: string, reason: string) {
  await prisma.cu12Account.updateMany({
    where: { userId },
    data: {
      accountStatus: "NEEDS_REAUTH",
      statusReason: reason,
      updatedAt: new Date(),
    },
  });
}

export async function markAccountConnected(userId: string) {
  await prisma.cu12Account.updateMany({
    where: { userId },
    data: {
      accountStatus: "CONNECTED",
      statusReason: null,
      updatedAt: new Date(),
    },
  });
}

export async function persistSnapshot(
  userId: string,
  data: {
    courses: CourseState[];
    notices: CourseNotice[];
    notifications: NotificationEvent[];
    tasks: LearningTask[];
  },
): Promise<PersistSnapshotResult> {
  const noticeKeys = Array.from(new Set(data.notices.map((notice) => notice.noticeKey)));
  const notifications = data.notifications.filter((event) => event.notifierSeq.trim().length > 0);
  const notifierSeqs = Array.from(new Set(notifications.map((event) => event.notifierSeq)));

  const [existingNoticeRows, existingNotificationRows] = await Promise.all([
    noticeKeys.length > 0
      ? prisma.courseNotice.findMany({
        where: { userId, noticeKey: { in: noticeKeys } },
        select: { noticeKey: true },
      })
      : Promise.resolve([]),
    notifierSeqs.length > 0
      ? prisma.notificationEvent.findMany({
        where: { userId, notifierSeq: { in: notifierSeqs } },
        select: { notifierSeq: true },
      })
      : Promise.resolve([]),
  ]);

  const existingNoticeSet = new Set(existingNoticeRows.map((row) => row.noticeKey));
  const existingNotificationSet = new Set(existingNotificationRows.map((row) => row.notifierSeq));

  let newNoticeCount = 0;
  let newNotificationCount = 0;
  let newUnreadNotificationCount = 0;

  for (const course of data.courses) {
    await runWithPrismaRetry(() =>
      prisma.courseSnapshot.upsert({
        where: {
          userId_lectureSeq: {
            userId,
            lectureSeq: course.lectureSeq,
          },
        },
        update: {
          title: course.title,
          instructor: course.instructor,
          progressPercent: course.progressPercent,
          remainDays: course.remainDays,
          recentLearnedAt: toDate(course.recentLearnedAt),
          periodStart: toDate(course.periodStart),
          periodEnd: toDate(course.periodEnd),
          status: course.status,
          syncedAt: new Date(course.syncedAt),
        },
        create: {
          userId,
          lectureSeq: course.lectureSeq,
          title: course.title,
          instructor: course.instructor,
          progressPercent: course.progressPercent,
          remainDays: course.remainDays,
          recentLearnedAt: toDate(course.recentLearnedAt),
          periodStart: toDate(course.periodStart),
          periodEnd: toDate(course.periodEnd),
          status: course.status,
          syncedAt: new Date(course.syncedAt),
        },
      }),
    );
  }

  for (const notice of data.notices) {
    const isNewRecord = !existingNoticeSet.has(notice.noticeKey);

    await runWithPrismaRetry(() =>
      prisma.courseNotice.upsert({
        where: {
          userId_lectureSeq_noticeKey: {
            userId,
            lectureSeq: notice.lectureSeq,
            noticeKey: notice.noticeKey,
          },
        },
        update: {
          title: notice.title,
          author: notice.author,
          postedAt: toDate(notice.postedAt),
          bodyText: notice.bodyText,
          isNew: notice.isNew,
          syncedAt: new Date(notice.syncedAt),
        },
        create: {
          userId,
          lectureSeq: notice.lectureSeq,
          noticeKey: notice.noticeKey,
          title: notice.title,
          author: notice.author,
          postedAt: toDate(notice.postedAt),
          bodyText: notice.bodyText,
          isNew: notice.isNew,
          syncedAt: new Date(notice.syncedAt),
          isRead: false,
        },
      }),
    );

    if (isNewRecord) {
      newNoticeCount += 1;
    }
  }

  for (const event of notifications) {
    const isNewRecord = !existingNotificationSet.has(event.notifierSeq);

    await runWithPrismaRetry(() =>
      prisma.notificationEvent.upsert({
        where: {
          userId_notifierSeq: {
            userId,
            notifierSeq: event.notifierSeq,
          },
        },
        update: {
          courseTitle: event.courseTitle,
          category: event.category,
          message: event.message,
          occurredAt: toDate(event.occurredAt),
          isCanceled: event.isCanceled,
          isUnread: event.isUnread,
          syncedAt: new Date(event.syncedAt),
        },
        create: {
          userId,
          notifierSeq: event.notifierSeq,
          courseTitle: event.courseTitle,
          category: event.category,
          message: event.message,
          occurredAt: toDate(event.occurredAt),
          isCanceled: event.isCanceled,
          isUnread: event.isUnread,
          syncedAt: new Date(event.syncedAt),
        },
      }),
    );

    if (isNewRecord) {
      newNotificationCount += 1;
      if (event.isUnread) {
        newUnreadNotificationCount += 1;
      }
    }

    existingNotificationSet.add(event.notifierSeq);
  }

  for (const task of data.tasks) {
    await runWithPrismaRetry(() =>
      prisma.learningTask.upsert({
        where: {
          userId_lectureSeq_courseContentsSeq: {
            userId,
            lectureSeq: task.lectureSeq,
            courseContentsSeq: task.courseContentsSeq,
          },
        },
        update: {
          weekNo: task.weekNo,
          lessonNo: task.lessonNo,
          activityType: task.activityType,
          requiredSeconds: task.requiredSeconds,
          learnedSeconds: task.learnedSeconds,
          state: task.state,
          availableFrom: toDate(task.availableFrom ?? null),
          dueAt: toDate(task.dueAt ?? null),
        },
        create: {
          userId,
          lectureSeq: task.lectureSeq,
          courseContentsSeq: task.courseContentsSeq,
          weekNo: task.weekNo,
          lessonNo: task.lessonNo,
          activityType: task.activityType,
          requiredSeconds: task.requiredSeconds,
          learnedSeconds: task.learnedSeconds,
          state: task.state,
          availableFrom: toDate(task.availableFrom ?? null),
          dueAt: toDate(task.dueAt ?? null),
        },
      }),
    );
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const deadlineTasks = data.tasks
    .filter((task) => task.state === "PENDING" && typeof task.dueAt === "string")
    .map((task) => ({
      lectureSeq: task.lectureSeq,
      courseContentsSeq: task.courseContentsSeq,
      weekNo: task.weekNo,
      lessonNo: task.lessonNo,
      dueAt: task.dueAt as string,
      dueAtMs: new Date(task.dueAt as string).getTime(),
    }))
    .filter((task) => Number.isFinite(task.dueAtMs) && task.dueAtMs >= now && task.dueAtMs - now <= sevenDaysMs)
    .sort((a, b) => a.dueAtMs - b.dueAtMs)
    .map((task) => ({
      lectureSeq: task.lectureSeq,
      courseContentsSeq: task.courseContentsSeq,
      weekNo: task.weekNo,
      lessonNo: task.lessonNo,
      dueAt: task.dueAt,
    }));

  const pendingTaskCount = data.tasks.filter((task) => task.state === "PENDING").length;

  return {
    newNoticeCount,
    newNotificationCount,
    newUnreadNotificationCount,
    deadlineTasks,
    pendingTaskCount,
  };
}

export async function recordLearningRun(
  userId: string,
  lectureSeq: number | null,
  status: "SUCCESS" | "FAILED",
  message?: string,
) {
  await prisma.learningRun.create({
    data: {
      userId,
      lectureSeq: lectureSeq ?? 0,
      startedAt: new Date(),
      endedAt: new Date(),
      status,
      message,
    },
  });
}

export async function recordMailDelivery(
  userId: string,
  toEmail: string,
  subject: string,
  status: "SENT" | "FAILED" | "SKIPPED",
  error?: string,
) {
  await prisma.mailDelivery.create({
    data: {
      userId,
      toEmail,
      subject,
      status,
      error,
      sentAt: status === "SENT" ? new Date() : null,
    },
  });
}

export async function markTaskDeadlineAlerted(
  userId: string,
  task: {
    lectureSeq: number;
    courseContentsSeq: number;
    dueAt: Date;
  },
  thresholdDays: number,
) {
  try {
    await prisma.taskDeadlineAlert.create({
      data: {
        userId,
        lectureSeq: task.lectureSeq,
        courseContentsSeq: task.courseContentsSeq,
        thresholdDays,
        dueAt: task.dueAt,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

