import { CourseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

interface ActivityTypeCounts {
  VOD: number;
  QUIZ: number;
  ASSIGNMENT: number;
  ETC: number;
}

interface CourseWeekSummary {
  weekNo: number;
  totalTaskCount: number;
  completedTaskCount: number;
  pendingTaskCount: number;
  totalTaskTypeCounts: ActivityTypeCounts;
  pendingTaskTypeCounts: ActivityTypeCounts;
}

function daysUntil(target: Date, now: Date): number {
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function createActivityTypeCounts(): ActivityTypeCounts {
  return {
    VOD: 0,
    QUIZ: 0,
    ASSIGNMENT: 0,
    ETC: 0,
  };
}

function mapNoticeCountsByLecture(
  rows: Array<{ lectureSeq: number; _count: { _all: number } }>,
): Map<number, number> {
  return new Map(rows.map((row) => [row.lectureSeq, row._count._all]));
}

export async function getDashboardSummary(userId: string) {
  const now = new Date();
  const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

  const [activeCourseCount, progressAgg, unreadNoticeCount, urgentTaskCount, nextDeadlineTask, lastSync] = await Promise.all([
    prisma.courseSnapshot.count({ where: { userId, status: CourseStatus.ACTIVE } }),
    prisma.courseSnapshot.aggregate({
      where: { userId, status: CourseStatus.ACTIVE },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.learningTask.count({
      where: {
        userId,
        state: "PENDING",
        dueAt: {
          gte: now,
          lte: soon,
        },
      },
    }),
    prisma.learningTask.findFirst({
      where: {
        userId,
        state: "PENDING",
        dueAt: { gte: now },
      },
      orderBy: { dueAt: "asc" },
      select: { dueAt: true },
    }),
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
    upcomingDeadlines: urgentTaskCount,
    urgentTaskCount,
    nextDeadlineAt: nextDeadlineTask?.dueAt ?? null,
    lastSyncAt: lastSync?.finishedAt ?? null,
    initialSyncRequired: !lastSync,
  };
}

export async function getCourses(userId: string) {
  const now = new Date();

  const [courses, tasks, noticeCounts, unreadNoticeCounts] = await Promise.all([
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
        availableFrom: true,
        dueAt: true,
      },
    }),
    prisma.courseNotice.groupBy({
      by: ["lectureSeq"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.courseNotice.groupBy({
      by: ["lectureSeq"],
      where: { userId, isRead: false },
      _count: { _all: true },
    }),
  ]);

  const grouped = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const list = grouped.get(task.lectureSeq) ?? [];
    list.push(task);
    grouped.set(task.lectureSeq, list);
  }

  const noticeCountByLectureSeq = mapNoticeCountsByLecture(noticeCounts);
  const unreadNoticeCountByLectureSeq = new Map<number, number>(unreadNoticeCounts.map((row) => [row.lectureSeq, row._count._all]));

  return courses.map((course) => {
    const taskList = grouped.get(course.lectureSeq) ?? [];
    const toDueTime = (task: typeof taskList[number]) => task.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const pending = taskList
      .filter((task) => task.state === "PENDING")
      .sort((a, b) => {
        const dueA = toDueTime(a);
        const dueB = toDueTime(b);
        if (dueA !== dueB) return dueA - dueB;
        return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
      });

    const completed = taskList.filter((task) => task.state === "COMPLETED");
    const totalTaskCount = taskList.length;
    const completedTaskCount = completed.length;
    const pendingTaskCount = pending.length;
    const totalRequiredSeconds = taskList.reduce((acc, task) => acc + task.requiredSeconds, 0);
    const totalLearnedSeconds = taskList.reduce((acc, task) => acc + task.learnedSeconds, 0);

    const taskTypeCounts = createActivityTypeCounts();
    const pendingTaskTypeCounts = createActivityTypeCounts();
    const weekProgressByWeek = new Map<number, Omit<CourseWeekSummary, "pendingTaskTypeCounts"> & {
      pendingTaskTypeCounts: ActivityTypeCounts;
    }>();

    for (const task of taskList) {
      taskTypeCounts[task.activityType] += 1;

      const existing = weekProgressByWeek.get(task.weekNo) ?? {
        weekNo: task.weekNo,
        totalTaskCount: 0,
        completedTaskCount: 0,
        pendingTaskCount: 0,
        totalTaskTypeCounts: createActivityTypeCounts(),
        pendingTaskTypeCounts: createActivityTypeCounts(),
      };

      existing.totalTaskCount += 1;
      existing.totalTaskTypeCounts[task.activityType] += 1;

      if (task.state === "COMPLETED") {
        existing.completedTaskCount += 1;
      } else {
        existing.pendingTaskCount += 1;
        pendingTaskTypeCounts[task.activityType] += 1;
        existing.pendingTaskTypeCounts[task.activityType] += 1;
      }

      weekProgressByWeek.set(task.weekNo, existing);
    }

    const weekSummaries = Array.from(weekProgressByWeek.values())
      .sort((a, b) => a.weekNo - b.weekNo)
      .map((summary) => summary);

    const nowPending = pending.find((task) => task.dueAt && task.dueAt >= now);
    const currentWeekNo = nowPending?.weekNo ?? pending[0]?.weekNo ?? taskList[0]?.weekNo ?? null;

    return {
      ...course,
      pendingTaskCount,
      completedTaskCount,
      totalTaskCount,
      totalRequiredSeconds,
      totalLearnedSeconds,
      currentWeekNo,
      taskTypeCounts,
      pendingTaskTypeCounts,
      weekSummaries,
      noticeCount: noticeCountByLectureSeq.get(course.lectureSeq) ?? 0,
      unreadNoticeCount: unreadNoticeCountByLectureSeq.get(course.lectureSeq) ?? 0,
      nextPendingTask: pending[0]
        ? {
          weekNo: pending[0].weekNo,
          lessonNo: pending[0].lessonNo,
          activityType: pending[0].activityType,
          requiredSeconds: pending[0].requiredSeconds,
          learnedSeconds: pending[0].learnedSeconds,
          availableFrom: pending[0].availableFrom,
          dueAt: pending[0].dueAt,
        }
        : null,
    };
  });
}

export async function getUpcomingDeadlines(userId: string, limit = 30) {
  const now = new Date();
  const tasks = await prisma.learningTask.findMany({
    where: {
      userId,
      state: "PENDING",
      dueAt: {
        gte: now,
      },
    },
    orderBy: { dueAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      lectureSeq: true,
      courseContentsSeq: true,
      weekNo: true,
      lessonNo: true,
      requiredSeconds: true,
      learnedSeconds: true,
      availableFrom: true,
      dueAt: true,
    },
  });

  const seqs = Array.from(new Set(tasks.map((task) => task.lectureSeq)));
  const courses = seqs.length > 0
    ? await prisma.courseSnapshot.findMany({
      where: {
        userId,
        lectureSeq: { in: seqs },
      },
      select: {
        lectureSeq: true,
        title: true,
      },
    })
    : [];
  const titleBySeq = new Map(courses.map((course) => [course.lectureSeq, course.title]));

  return tasks.map((task) => ({
    ...task,
    courseTitle: titleBySeq.get(task.lectureSeq) ?? `코스 ${task.lectureSeq}`,
    remainingSeconds: Math.max(0, task.requiredSeconds - task.learnedSeconds),
    daysLeft: task.dueAt ? daysUntil(task.dueAt, now) : null,
  }));
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

