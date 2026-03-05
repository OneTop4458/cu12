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

const AUTO_SYNC_INTERVAL_HOURS = 2;

function isTaskCompletedByProgress(task: { state: string; activityType: string; requiredSeconds: number; learnedSeconds: number }): boolean {
  if (task.state === "COMPLETED") return true;
  if (task.state === "FAILED") return false;
  if (task.activityType === "VOD" && task.requiredSeconds > 0 && task.learnedSeconds >= task.requiredSeconds) {
    return true;
  }
  return false;
}

function getNextScheduledSyncAt(now: Date): Date {
  const currentHour = now.getUTCHours();
  const hasMinuteProgress = now.getUTCMinutes() > 0 || now.getUTCSeconds() > 0 || now.getUTCMilliseconds() > 0;
  let nextHour = currentHour + (hasMinuteProgress ? 1 : 0);
  if (nextHour % AUTO_SYNC_INTERVAL_HOURS !== 0) {
    nextHour += AUTO_SYNC_INTERVAL_HOURS - (nextHour % AUTO_SYNC_INTERVAL_HOURS);
  }

  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    nextHour,
    0,
    0,
    0,
  ));
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
  const upcomingWindowTasks = await prisma.learningTask.findMany({
    where: {
      userId,
      dueAt: {
        gte: now,
        lte: soon,
      },
    },
    select: {
      dueAt: true,
      state: true,
      activityType: true,
      requiredSeconds: true,
      learnedSeconds: true,
    },
    orderBy: { dueAt: "asc" },
  });
  const upcomingPendingTasks = upcomingWindowTasks.filter((task) => !isTaskCompletedByProgress(task));

  const [activeCourseCount, progressAgg, unreadNoticeCount, lastSync] = await Promise.all([
    prisma.courseSnapshot.count({ where: { userId, status: CourseStatus.ACTIVE } }),
    prisma.courseSnapshot.aggregate({
      where: { userId, status: CourseStatus.ACTIVE },
      _avg: { progressPercent: true },
    }),
    prisma.courseNotice.count({ where: { userId, isRead: false } }),
    prisma.jobQueue.findFirst({
      where: { userId, type: "SYNC", status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  const nextAutoSyncAt = getNextScheduledSyncAt(now);
  const nextDeadlineTask = upcomingPendingTasks[0] ?? null;

  return {
    activeCourseCount,
    avgProgress: progressAgg._avg.progressPercent ?? 0,
    unreadNoticeCount,
    upcomingDeadlines: upcomingPendingTasks.length,
    urgentTaskCount: upcomingPendingTasks.length,
    nextDeadlineAt: nextDeadlineTask?.dueAt ?? null,
    lastSyncAt: lastSync?.finishedAt ?? null,
    nextAutoSyncAt,
    autoSyncIntervalHours: AUTO_SYNC_INTERVAL_HOURS,
    initialSyncRequired: !lastSync,
  };
}

export async function getCourses(userId: string) {
  const now = new Date();
  const nowMs = now.getTime();

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
    const rawTaskList = grouped.get(course.lectureSeq) ?? [];
    const taskList = rawTaskList;
    const isTaskPending = (task: typeof taskList[number]) => !isTaskCompletedByProgress(task);
    const toDueTime = (task: typeof taskList[number]) => task.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const toWindowTime = (task: typeof taskList[number]) => {
      if (task.dueAt) return task.dueAt.getTime();
      if (task.availableFrom) return task.availableFrom.getTime();
      return Number.MAX_SAFE_INTEGER;
    };
    const pendingWithWindow = taskList
      .filter(isTaskPending)
      .sort((a, b) => {
        const dueA = toWindowTime(a);
        const dueB = toWindowTime(b);
        if (dueA !== dueB) return dueA - dueB;
        return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
      });

    const pending = taskList
      .filter(isTaskPending)
      .sort((a, b) => {
        const dueA = toDueTime(a);
        const dueB = toDueTime(b);
        if (dueA !== dueB) return dueA - dueB;
        return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
      });

    const completed = taskList.filter((task) => !isTaskPending(task));
    const totalTaskCount = taskList.length;
    const completedTaskCount = completed.length;
    const pendingTaskCount = pending.length;
    const isCourseCompleted = totalTaskCount > 0 && pendingTaskCount === 0;
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

      if (isTaskCompletedByProgress(task)) {
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
    const pendingByWeek = weekSummaries.filter((summary) => summary.pendingTaskCount > 0);
    const earliestPendingByWeek = pendingByWeek[0] ?? null;
    const latestTask = taskList.length > 0
      ? taskList
        .slice()
        .sort((a, b) => {
          if (a.weekNo !== b.weekNo) return a.weekNo - b.weekNo;
          return a.lessonNo - b.lessonNo;
        })
        [taskList.length - 1] ?? null
      : null;
    const earliestPendingTask = pending.length > 0
      ? pending
        .slice()
        .sort((a, b) => {
          if (a.weekNo !== b.weekNo) return a.weekNo - b.weekNo;
          return a.lessonNo - b.lessonNo;
        })[0] ?? null
      : null;

    const windowPendingTasks = pendingWithWindow.filter((task) => task.dueAt || task.availableFrom);
    const nowWindowPending = windowPendingTasks.find((task) => {
      const startMs = task.availableFrom ? task.availableFrom.getTime() : Number.MIN_SAFE_INTEGER;
      const dueMs = task.dueAt ? task.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
      return startMs <= nowMs && nowMs <= dueMs;
    }) ?? null;
    const nextWindowPending = windowPendingTasks.find((task) => (task.dueAt ? task.dueAt.getTime() >= nowMs : true)) ?? windowPendingTasks[0] ?? null;
    const firstWindowTask = windowPendingTasks[0]
      ?? taskList
        .slice()
        .sort((a, b) => {
          const aWindow = toWindowTime(a);
          const bWindow = toWindowTime(b);
          if (aWindow !== bWindow) return aWindow - bWindow;
          return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
        })[0] ?? null;
    const lastWindowTask = (() => {
      const tasks = windowPendingTasks.slice().sort((a, b) => {
        const aWindow = toWindowTime(a);
        const bWindow = toWindowTime(b);
        if (aWindow !== bWindow) return aWindow - bWindow;
        return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
      });
      return tasks[tasks.length - 1] ?? null;
    })();
    const currentWeekNo = isCourseCompleted
      ? (weekSummaries.length > 0 ? weekSummaries[weekSummaries.length - 1].weekNo : (latestTask?.weekNo ?? null))
      : (nowWindowPending?.weekNo
        ?? nextWindowPending?.weekNo
        ?? earliestPendingByWeek?.weekNo
        ?? earliestPendingTask?.weekNo
        ?? pendingWithWindow[0]?.weekNo
        ?? latestTask?.weekNo
        ?? null);
    const thisWeekPending = currentWeekNo === null ? [] : pendingWithWindow.filter((task) => task.weekNo === currentWeekNo);
    const courseDeadlineTask = isCourseCompleted
      ? (lastWindowTask ?? firstWindowTask ?? earliestPendingTask)
      : (nextWindowPending ?? firstWindowTask ?? earliestPendingTask);
    const deadlineReferenceTask = nextWindowPending ?? courseDeadlineTask;
    const isCurrentWeekDeadline = Boolean(
      deadlineReferenceTask
      && currentWeekNo !== null
      && deadlineReferenceTask.weekNo === currentWeekNo,
    );
    const deadlineLabel = (nowWindowPending || isCurrentWeekDeadline || (pending.length > 0 && !nextWindowPending))
      ? "이번 차시 마감"
      : "다음 차시 마감";

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
      nextPendingTask: nextWindowPending
        ? {
          weekNo: nextWindowPending.weekNo,
          lessonNo: nextWindowPending.lessonNo,
          activityType: nextWindowPending.activityType,
          requiredSeconds: nextWindowPending.requiredSeconds,
          learnedSeconds: nextWindowPending.learnedSeconds,
          availableFrom: nextWindowPending.availableFrom,
          dueAt: nextWindowPending.dueAt,
        }
        : courseDeadlineTask
          ? {
            weekNo: courseDeadlineTask.weekNo,
            lessonNo: courseDeadlineTask.lessonNo,
            activityType: courseDeadlineTask.activityType,
            requiredSeconds: courseDeadlineTask.requiredSeconds,
            learnedSeconds: courseDeadlineTask.learnedSeconds,
            availableFrom: courseDeadlineTask.availableFrom,
            dueAt: courseDeadlineTask.dueAt,
          }
          : null,
      deadlineLabel,
    };
  });
}

export async function getUpcomingDeadlines(userId: string, limit = 30) {
  const now = new Date();
  const tasksRaw = await prisma.learningTask.findMany({
    where: {
      userId,
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
      state: true,
      activityType: true,
      requiredSeconds: true,
      learnedSeconds: true,
      availableFrom: true,
      dueAt: true,
    },
  });
  const tasks = tasksRaw
    .map((task) => ({
      ...task,
      isCompleted: isTaskCompletedByProgress(task),
    }))
    .sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) {
        return Number(a.isCompleted) - Number(b.isCompleted);
      }
      const dueA = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      if (a.lectureSeq !== b.lectureSeq) return a.lectureSeq - b.lectureSeq;
      if (a.weekNo !== b.weekNo) return a.weekNo - b.weekNo;
      return a.lessonNo - b.lessonNo;
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
    courseTitle: titleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`,
    remainingSeconds: Math.max(0, task.requiredSeconds - task.learnedSeconds),
    daysLeft: task.dueAt ? daysUntil(task.dueAt, now) : null,
  }));
}

export async function getDashboardDiagnostics(
  userId: string,
  options?: {
    lectureSeq?: number;
    sampleLimit?: number;
  },
) {
  const now = new Date();
  const nowMs = now.getTime();
  const sampleLimit = Math.min(Math.max(options?.sampleLimit ?? 20, 1), 100);
  const lectureFilter = options?.lectureSeq ? { lectureSeq: options.lectureSeq } : {};

  const [courses, tasks, totalNoticeCount, emptyNoticeCount, noticeSamples, recentJobs] = await Promise.all([
    prisma.courseSnapshot.findMany({
      where: { userId, ...lectureFilter },
      select: {
        lectureSeq: true,
        title: true,
      },
      orderBy: { lectureSeq: "asc" },
    }),
    prisma.learningTask.findMany({
      where: { userId, ...lectureFilter },
      select: {
        lectureSeq: true,
        courseContentsSeq: true,
        weekNo: true,
        lessonNo: true,
        activityType: true,
        state: true,
        availableFrom: true,
        dueAt: true,
        requiredSeconds: true,
        learnedSeconds: true,
      },
      orderBy: [{ lectureSeq: "asc" }, { weekNo: "asc" }, { lessonNo: "asc" }],
    }),
    prisma.courseNotice.count({
      where: { userId, ...lectureFilter },
    }),
    prisma.courseNotice.count({
      where: { userId, ...lectureFilter, bodyText: "" },
    }),
    prisma.courseNotice.findMany({
      where: { userId, ...lectureFilter },
      take: sampleLimit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        lectureSeq: true,
        title: true,
        postedAt: true,
        bodyText: true,
        updatedAt: true,
      },
    }),
    prisma.jobQueue.findMany({
      where: {
        userId,
        type: { in: ["SYNC", "NOTICE_SCAN"] },
      },
      take: Math.min(sampleLimit, 30),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        lastError: true,
      },
    }),
  ]);

  const titleByLectureSeq = new Map(courses.map((course) => [course.lectureSeq, course.title]));
  const groupedTasks = new Map<number, typeof tasks>();
  for (const task of tasks) {
    const list = groupedTasks.get(task.lectureSeq) ?? [];
    list.push(task);
    groupedTasks.set(task.lectureSeq, list);
  }

  const lectureSeqs = Array.from(
    new Set([
      ...courses.map((course) => course.lectureSeq),
      ...tasks.map((task) => task.lectureSeq),
    ]),
  ).sort((a, b) => a - b);

  const lectures = lectureSeqs.map((lectureSeq) => {
    const taskList = groupedTasks.get(lectureSeq) ?? [];
    const pendingTasks = taskList.filter((task) => !isTaskCompletedByProgress(task));
    const pendingWithWindow = pendingTasks.filter((task) => task.dueAt || task.availableFrom);
    const pendingWithoutWindow = pendingTasks.filter((task) => !task.dueAt && !task.availableFrom);
    const sortedWindow = [...pendingWithWindow].sort((a, b) => {
      const aTime = a.dueAt?.getTime() ?? a.availableFrom?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.dueAt?.getTime() ?? b.availableFrom?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo);
    });
    const nowWindowPending = sortedWindow.find((task) => {
      const startMs = task.availableFrom ? task.availableFrom.getTime() : Number.MIN_SAFE_INTEGER;
      const dueMs = task.dueAt ? task.dueAt.getTime() : Number.MAX_SAFE_INTEGER;
      return startMs <= nowMs && nowMs <= dueMs;
    }) ?? null;
    const nextWindowPending = sortedWindow.find((task) => (task.dueAt ? task.dueAt.getTime() >= nowMs : true))
      ?? sortedWindow[0]
      ?? null;
    const nextPendingCandidate = nowWindowPending ?? nextWindowPending;

    return {
      lectureSeq,
      title: titleByLectureSeq.get(lectureSeq) ?? `강좌 ${lectureSeq}`,
      pendingTotal: pendingTasks.length,
      pendingWithWindow: pendingWithWindow.length,
      pendingWithoutWindow: pendingWithoutWindow.length,
      nextPendingCandidate: nextPendingCandidate
        ? {
          courseContentsSeq: nextPendingCandidate.courseContentsSeq,
          weekNo: nextPendingCandidate.weekNo,
          lessonNo: nextPendingCandidate.lessonNo,
          activityType: nextPendingCandidate.activityType,
          availableFrom: nextPendingCandidate.availableFrom,
          dueAt: nextPendingCandidate.dueAt,
          requiredSeconds: nextPendingCandidate.requiredSeconds,
          learnedSeconds: nextPendingCandidate.learnedSeconds,
          state: nextPendingCandidate.state,
          isCurrentWindow: nowWindowPending?.courseContentsSeq === nextPendingCandidate.courseContentsSeq,
        }
        : null,
    };
  });

  const pendingTaskCount = tasks.filter((task) => !isTaskCompletedByProgress(task)).length;
  const pendingWithDueAtCount = tasks.filter(
    (task) => !isTaskCompletedByProgress(task) && Boolean(task.dueAt),
  ).length;
  const pendingWithWindowCount = tasks.filter(
    (task) => !isTaskCompletedByProgress(task) && Boolean(task.dueAt || task.availableFrom),
  ).length;
  const pendingWithoutWindowCount = tasks.filter(
    (task) => !isTaskCompletedByProgress(task) && !task.dueAt && !task.availableFrom,
  ).length;

  return {
    generatedAt: now.toISOString(),
    summary: {
      courseCount: courses.length,
      taskCount: tasks.length,
      pendingTaskCount,
      pendingWithDueAtCount,
      pendingWithWindowCount,
      pendingWithoutWindowCount,
    },
    lectures,
    notices: {
      totalCount: totalNoticeCount,
      emptyBodyCount: emptyNoticeCount,
      samples: noticeSamples.map((row) => ({
        id: row.id,
        lectureSeq: row.lectureSeq,
        title: row.title,
        postedAt: row.postedAt,
        updatedAt: row.updatedAt,
        bodyLength: row.bodyText.trim().length,
        isEmpty: row.bodyText.trim().length === 0,
      })),
    },
    jobs: recentJobs,
  };
}

type CourseNoticeRow = Awaited<ReturnType<typeof prisma.courseNotice.findMany>>[number];

function normalizeNoticeDedupeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractNoticeSeqFromNoticeKey(noticeKey: string): string | null {
  return noticeKey.match(/:seq:(\d+)/)?.[1] ?? null;
}

function areNoticeRowsEquivalent(a: CourseNoticeRow, b: CourseNoticeRow): boolean {
  const seqA = extractNoticeSeqFromNoticeKey(a.noticeKey);
  const seqB = extractNoticeSeqFromNoticeKey(b.noticeKey);
  if (seqA && seqB) {
    return seqA === seqB;
  }

  const titleA = normalizeNoticeDedupeText(a.title);
  const titleB = normalizeNoticeDedupeText(b.title);
  if (!titleA || !titleB || titleA !== titleB) {
    return false;
  }

  const postedA = a.postedAt?.toISOString().slice(0, 10) ?? "";
  const postedB = b.postedAt?.toISOString().slice(0, 10) ?? "";
  if (postedA && postedB && postedA !== postedB) {
    return false;
  }

  const authorA = normalizeNoticeDedupeText(a.author);
  const authorB = normalizeNoticeDedupeText(b.author);
  if (authorA && authorB && authorA !== authorB) {
    const bodyA = normalizeNoticeDedupeText(a.bodyText).slice(0, 200);
    const bodyB = normalizeNoticeDedupeText(b.bodyText).slice(0, 200);
    return bodyA.length > 0 && bodyA === bodyB;
  }

  return true;
}

function mergeNoticeRows(current: CourseNoticeRow, candidate: CourseNoticeRow): CourseNoticeRow {
  const currentSeq = extractNoticeSeqFromNoticeKey(current.noticeKey);
  const candidateSeq = extractNoticeSeqFromNoticeKey(candidate.noticeKey);
  const currentBodyLength = current.bodyText.trim().length;
  const candidateBodyLength = candidate.bodyText.trim().length;

  const preferCandidate =
    (!currentSeq && Boolean(candidateSeq))
    || candidateBodyLength > currentBodyLength
    || (!current.postedAt && Boolean(candidate.postedAt))
    || (!current.author && Boolean(candidate.author));

  const preferred = preferCandidate ? candidate : current;
  const secondary = preferCandidate ? current : candidate;

  return {
    ...preferred,
    author: preferred.author ?? secondary.author,
    postedAt: preferred.postedAt ?? secondary.postedAt,
    bodyText: preferred.bodyText.trim().length >= secondary.bodyText.trim().length
      ? preferred.bodyText
      : secondary.bodyText,
    isRead: preferred.isRead && secondary.isRead,
    isNew: preferred.isNew || secondary.isNew,
    syncedAt: preferred.syncedAt.getTime() >= secondary.syncedAt.getTime() ? preferred.syncedAt : secondary.syncedAt,
    updatedAt: preferred.updatedAt.getTime() >= secondary.updatedAt.getTime() ? preferred.updatedAt : secondary.updatedAt,
  };
}

function dedupeNoticeRows(rows: CourseNoticeRow[]): CourseNoticeRow[] {
  const deduped: CourseNoticeRow[] = [];

  for (const row of rows) {
    const duplicateIndex = deduped.findIndex((existing) => areNoticeRowsEquivalent(existing, row));
    if (duplicateIndex < 0) {
      deduped.push(row);
      continue;
    }
    deduped[duplicateIndex] = mergeNoticeRows(deduped[duplicateIndex], row);
  }

  return deduped;
}

export async function getNotices(userId: string, lectureSeq: number) {
  const rows = await prisma.courseNotice.findMany({
    where: { userId, lectureSeq },
    orderBy: [{ isRead: "asc" }, { postedAt: "desc" }],
  });
  return dedupeNoticeRows(rows);
}

export async function getNotifications(
  userId: string,
  options?: {
    unreadOnly?: boolean;
    includeArchived?: boolean;
    historyOnly?: boolean;
    limit?: number;
  },
) {
  const historyOnly = options?.historyOnly ?? false;

  return prisma.notificationEvent.findMany({
    where: {
      userId,
      ...(!historyOnly && !(options?.includeArchived ?? false) ? { isArchived: false } : {}),
      ...(options?.unreadOnly ? { isUnread: true } : {}),
      ...(historyOnly
        ? {
          OR: [
            { isUnread: false },
            { isArchived: true },
          ],
        }
        : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: options?.limit ?? 200,
  });
}
