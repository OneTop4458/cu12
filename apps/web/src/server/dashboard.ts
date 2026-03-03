import { CourseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getDashboardSummary(userId: string) {
  const [activeCourseCount, progressAgg, unreadNoticeCount, pendingTasksCount, lastSync] = await Promise.all([
    prisma.courseSnapshot.count({ where: { userId, status: CourseStatus.ACTIVE } }),
    prisma.courseSnapshot.aggregate({
      where: { userId, status: CourseStatus.ACTIVE },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.learningTask.count({ where: { userId, state: "PENDING" } }),
    prisma.jobQueue.findFirst({
      where: { userId, type: "SYNC", status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return {
    activeCourseCount,
    avgProgress: progressAgg._avg.progressPercent ?? 0,
    unreadNoticeCount,
    upcomingDeadlines: pendingTasksCount,
    lastSyncAt: lastSync?.finishedAt ?? null,
  };
}

export async function getCourses(userId: string) {
  return prisma.courseSnapshot.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { title: "asc" }],
  });
}

export async function getNotices(userId: string, lectureSeq: number) {
  return prisma.courseNotice.findMany({
    where: { userId, lectureSeq },
    orderBy: { postedAt: "desc" },
  });
}

export async function getNotifications(userId: string) {
  return prisma.notificationEvent.findMany({
    where: { userId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}
