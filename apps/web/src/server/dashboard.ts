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
    initialSyncRequired: !lastSync,
  };
}

export async function getCourses(userId: string) {
  const [courses, tasks] = await Promise.all([
    prisma.courseSnapshot.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { remainDays: "asc" }, { title: "asc" }],
    }),
    prisma.learningTask.findMany({
      where: { userId },
      select: {
        lectureSeq: true,
        weekNo: true,
        lessonNo: true,
        state: true,
        requiredSeconds: true,
        learnedSeconds: true,
        activityType: true,
      },
    }),
  ]);

  const grouped = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const list = grouped.get(task.lectureSeq) ?? [];
    list.push(task);
    grouped.set(task.lectureSeq, list);
  }

  return courses.map((course) => {
    const taskList = grouped.get(course.lectureSeq) ?? [];
    const pending = taskList
      .filter((task) => task.state === "PENDING")
      .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));

    const completedCount = taskList.filter((task) => task.state === "COMPLETED").length;
    const totalTaskCount = taskList.length;
    const totalRequiredSeconds = taskList.reduce((acc, task) => acc + task.requiredSeconds, 0);
    const totalLearnedSeconds = taskList.reduce((acc, task) => acc + task.learnedSeconds, 0);

    return {
      ...course,
      pendingTaskCount: pending.length,
      completedTaskCount: completedCount,
      totalTaskCount,
      totalRequiredSeconds,
      totalLearnedSeconds,
      currentWeekNo: pending[0]?.weekNo ?? taskList[0]?.weekNo ?? null,
      nextPendingTask: pending[0]
        ? {
          weekNo: pending[0].weekNo,
          lessonNo: pending[0].lessonNo,
          activityType: pending[0].activityType,
        }
        : null,
    };
  });
}

export async function getNotices(userId: string, lectureSeq: number) {
  return prisma.courseNotice.findMany({
    where: { userId, lectureSeq },
    orderBy: [{ isRead: "asc" }, { postedAt: "desc" }],
  });
}

export async function getNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
  },
) {
  return prisma.notificationEvent.findMany({
    where: {
      userId,
      ...(options?.unreadOnly ? { isUnread: true } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: options?.limit ?? 200,
  });
}
