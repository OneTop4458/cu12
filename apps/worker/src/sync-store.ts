import type { CourseNotice, CourseState, LearningTask, NotificationEvent } from "@cu12/core";
import { prisma } from "./prisma";
import { decryptSecret } from "./secret";

function toDate(value: string | null): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00+09:00`);
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
) {
  await prisma.$transaction(async (tx) => {
    for (const course of data.courses) {
      await tx.courseSnapshot.upsert({
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
      });
    }

    for (const notice of data.notices) {
      await tx.courseNotice.upsert({
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
      });
    }

    for (const event of data.notifications) {
      await tx.notificationEvent.upsert({
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
      });
    }

    for (const task of data.tasks) {
      await tx.learningTask.upsert({
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
          requiredSeconds: task.requiredSeconds,
          learnedSeconds: task.learnedSeconds,
          state: task.state,
        },
        create: {
          userId,
          lectureSeq: task.lectureSeq,
          courseContentsSeq: task.courseContentsSeq,
          weekNo: task.weekNo,
          lessonNo: task.lessonNo,
          requiredSeconds: task.requiredSeconds,
          learnedSeconds: task.learnedSeconds,
          state: task.state,
        },
      });
    }
  });
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
