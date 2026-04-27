import { PORTAL_PROVIDERS, type PortalProvider } from "@cu12/core";
import { CourseStatus, Prisma } from "@prisma/client";
import { isMissingProviderColumnError, warnMissingProviderColumn } from "@/lib/provider-compat";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalProvider } from "@/server/current-provider";

interface ActivityTypeCounts {
  VOD: number;
  MATERIAL: number;
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

type LearningTaskActivityType = "VOD" | "MATERIAL" | "QUIZ" | "ASSIGNMENT" | "ETC";
type LearningTaskState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

interface LearningTaskRow {
  lectureSeq: number;
  courseContentsSeq: number;
  weekNo: number;
  lessonNo: number;
  activityType: LearningTaskActivityType | string;
  state: LearningTaskState | string;
  requiredSeconds: number;
  learnedSeconds: number;
  availableFrom: Date | null;
  dueAt: Date | null;
}

interface CourseNoticeCountGroup {
  lectureSeq: number;
  _count: { _all: number };
}

interface CourseSnapshotRow {
  id: string;
  userId: string;
  provider: PortalProvider;
  lectureSeq: number;
  externalLectureId: string | null;
  title: string;
  instructor: string | null;
  progressPercent: number;
  remainDays: number | null;
  recentLearnedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  status: CourseStatus;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface CourseNoticeSampleRow {
  id: string;
  lectureSeq: number;
  title: string;
  postedAt: Date | null;
  bodyText: string;
  updatedAt: Date;
}

export type DashboardActivityKind = "NOTICE" | "NOTIFICATION" | "MESSAGE" | "SYSTEM";

export interface DashboardActivityItem {
  id: string;
  sourceId: string;
  kind: DashboardActivityKind;
  provider: PortalProvider;
  title: string;
  courseTitle: string;
  message: string;
  occurredAt: Date | null;
  createdAt: Date;
  isUnread: boolean;
  isArchived: boolean;
  needsAttention: boolean;
}

const AUTO_SYNC_INTERVAL_HOURS = 2;
const AUTO_SYNC_MIN_INTERVAL_MINUTES = AUTO_SYNC_INTERVAL_HOURS * 60;

export interface DashboardSummary {
  activeCourseCount: number;
  avgProgress: number;
  unreadNoticeCount: number;
  upcomingDeadlines: number;
  urgentTaskCount: number;
  nextDeadlineAt: Date | null;
  lastSyncAt: Date | null;
  nextAutoSyncAt: Date;
  autoSyncIntervalHours: number;
  initialSyncRequired: boolean;
}

export function createEmptyDashboardSummary(now = new Date()): DashboardSummary {
  return {
    activeCourseCount: 0,
    avgProgress: 0,
    unreadNoticeCount: 0,
    upcomingDeadlines: 0,
    urgentTaskCount: 0,
    nextDeadlineAt: null,
    lastSyncAt: null,
    nextAutoSyncAt: getNextScheduledSyncAt(now),
    autoSyncIntervalHours: AUTO_SYNC_INTERVAL_HOURS,
    initialSyncRequired: false,
  };
}

function getJobPayloadProvider(payload: unknown): PortalProvider | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const provider = (payload as { provider?: unknown }).provider;
  return provider === "CYBER_CAMPUS" ? "CYBER_CAMPUS" : provider === "CU12" ? "CU12" : null;
}

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

function getNextAutoSyncAt(now: Date, recentSyncCreatedAt: Date | null): Date {
  if (!recentSyncCreatedAt) {
    return getNextScheduledSyncAt(now);
  }

  const earliestEligibleAt = new Date(
    recentSyncCreatedAt.getTime() + AUTO_SYNC_MIN_INTERVAL_MINUTES * 60_000,
  );
  const base = earliestEligibleAt.getTime() > now.getTime() ? earliestEligibleAt : now;
  return getNextScheduledSyncAt(base);
}

function daysUntil(target: Date, now: Date): number {
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getPortalMessageStore():
  | {
    findMany: (args: Prisma.PortalMessageFindManyArgs) => Promise<unknown[]>;
  }
  | null {
  const candidate = (prisma as unknown as Record<string, unknown>).portalMessage;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const delegate = candidate as { findMany?: (args: Prisma.PortalMessageFindManyArgs) => Promise<unknown[]> };
  return typeof delegate.findMany === "function" ? { findMany: delegate.findMany.bind(candidate) } : null;
}

function createActivityTypeCounts(): ActivityTypeCounts {
  return {
    VOD: 0,
    MATERIAL: 0,
    QUIZ: 0,
    ASSIGNMENT: 0,
    ETC: 0,
  };
}

function normalizeActivityType(value: string): LearningTaskActivityType {
  if (value === "VOD" || value === "MATERIAL" || value === "QUIZ" || value === "ASSIGNMENT") {
    return value;
  }
  return "ETC";
}

function normalizeCourseStatus(value: string): CourseStatus {
  if (value === CourseStatus.UPCOMING || value === CourseStatus.ENDED) {
    return value;
  }
  return CourseStatus.ACTIVE;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toSafeNumber(value, 0);
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isAttentionNotification(input: {
  category: string | null;
  message: string;
  isUnread: boolean;
  isCanceled?: boolean | null;
}): boolean {
  if (!input.isUnread || input.isCanceled) return false;
  const text = `${input.category ?? ""} ${input.message}`.toLowerCase();
  return /deadline|due|failed|failure|error|approval|auth|urgent|마감|기한|실패|오류|에러|승인|인증|긴급|자동수강/.test(text);
}

function normalizeActivityDate(value: Date | null, fallback: Date): Date {
  return value && !Number.isNaN(value.getTime()) ? value : fallback;
}

function normalizeCourseSnapshotRow(row: {
  id: string;
  userId: string;
  provider?: string | null;
  lectureSeq: number;
  externalLectureId?: string | null;
  title: string;
  instructor?: string | null;
  progressPercent: number | bigint | string;
  remainDays?: number | bigint | string | null;
  recentLearnedAt?: Date | string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  status: string;
  syncedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}, fallbackProvider: PortalProvider): CourseSnapshotRow {
  const provider = row.provider === "CYBER_CAMPUS" ? "CYBER_CAMPUS" : row.provider === "CU12" ? "CU12" : fallbackProvider;
  return {
    id: row.id,
    userId: row.userId,
    provider,
    lectureSeq: row.lectureSeq,
    externalLectureId: row.externalLectureId ?? null,
    title: row.title,
    instructor: row.instructor ?? null,
    progressPercent: toSafeNumber(row.progressPercent, 0),
    remainDays: toOptionalNumber(row.remainDays),
    recentLearnedAt: toDateOrNull(row.recentLearnedAt),
    periodStart: toDateOrNull(row.periodStart),
    periodEnd: toDateOrNull(row.periodEnd),
    status: normalizeCourseStatus(row.status),
    syncedAt: toDateOrNull(row.syncedAt) ?? new Date(0),
    createdAt: toDateOrNull(row.createdAt) ?? new Date(0),
    updatedAt: toDateOrNull(row.updatedAt) ?? new Date(0),
  };
}

function warnDashboardRawReadFallback(scope: string, error: unknown) {
  console.warn(
    `[dashboard] Falling back to raw ${scope} read because ORM-based read failed.`,
    error instanceof Error ? error.message : String(error),
  );
}

function appendSql(base: Prisma.Sql, fragment: Prisma.Sql | null): Prisma.Sql {
  if (!fragment) return base;
  return Prisma.sql`${base} ${fragment}`;
}

function buildCourseSnapshotOrderSql(orderBy?: "lectureSeqAsc" | "statusRemainDaysTitle"): Prisma.Sql {
  if (orderBy === "lectureSeqAsc") {
    return Prisma.sql`ORDER BY "lectureSeq" ASC`;
  }
  if (orderBy === "statusRemainDaysTitle") {
    return Prisma.sql`
      ORDER BY
        CASE "status"::text
          WHEN 'ACTIVE' THEN 0
          WHEN 'UPCOMING' THEN 1
          ELSE 2
        END ASC,
        "remainDays" ASC NULLS LAST,
        "title" ASC
    `;
  }
  return Prisma.empty;
}

function normalizeLearningTaskRow(row: LearningTaskRow): LearningTaskRow & { activityType: LearningTaskActivityType; state: LearningTaskState } {
  const state = row.state === "RUNNING" || row.state === "COMPLETED" || row.state === "FAILED"
    ? row.state
    : "PENDING";

  return {
    ...row,
    activityType: normalizeActivityType(row.activityType),
    state,
  };
}

async function isLegacyProviderMatch(userId: string, provider: PortalProvider): Promise<boolean> {
  return (await getCurrentPortalProvider(userId)) === provider;
}

async function withProviderCompatibility<T>(
  userId: string,
  provider: PortalProvider,
  loadScoped: () => Promise<T>,
  loadLegacy: () => Promise<T>,
  emptyValue: T,
): Promise<T> {
  try {
    return await loadScoped();
  } catch (error) {
    if (!isMissingProviderColumnError(error)) {
      throw error;
    }

    warnMissingProviderColumn();
    if (!(await isLegacyProviderMatch(userId, provider))) {
      return emptyValue;
    }

    return loadLegacy();
  }
}

async function loadCourseSnapshots(input: {
  userId: string;
  provider: PortalProvider;
  lectureSeq?: number;
  lectureSeqs?: number[];
  status?: CourseStatus;
  orderBy?: "lectureSeqAsc" | "statusRemainDaysTitle";
}): Promise<CourseSnapshotRow[]> {
  if (input.lectureSeqs && input.lectureSeqs.length === 0) {
    return [];
  }

  const baseWhere = {
    userId: input.userId,
    ...(typeof input.lectureSeq === "number" ? { lectureSeq: input.lectureSeq } : {}),
    ...(input.lectureSeqs && input.lectureSeqs.length > 0 ? { lectureSeq: { in: input.lectureSeqs } } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const baseSelect = {
    id: true,
    userId: true,
    lectureSeq: true,
    externalLectureId: true,
    title: true,
    instructor: true,
    progressPercent: true,
    remainDays: true,
    recentLearnedAt: true,
    periodStart: true,
    periodEnd: true,
    status: true,
    syncedAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;
  const orderBy = input.orderBy === "statusRemainDaysTitle"
    ? [{ status: "asc" as const }, { remainDays: "asc" as const }, { title: "asc" as const }]
    : input.orderBy === "lectureSeqAsc"
      ? [{ lectureSeq: "asc" as const }]
      : undefined;

  try {
    const rows = await withProviderCompatibility(
      input.userId,
      input.provider,
      () => prisma.courseSnapshot.findMany({
        where: {
          ...baseWhere,
          provider: input.provider,
        },
        ...(orderBy ? { orderBy } : {}),
        select: baseSelect,
      }),
      () => prisma.courseSnapshot.findMany({
        where: baseWhere,
        ...(orderBy ? { orderBy } : {}),
        select: baseSelect,
      }),
      [] as Array<{
        id: string;
        userId: string;
        lectureSeq: number;
        externalLectureId: string | null;
        title: string;
        instructor: string | null;
        progressPercent: number;
        remainDays: number | null;
        recentLearnedAt: Date | null;
        periodStart: Date | null;
        periodEnd: Date | null;
        status: CourseStatus;
        syncedAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }>,
    );

    return rows.map((row) => normalizeCourseSnapshotRow(row, input.provider));
  } catch (error) {
    warnDashboardRawReadFallback("course snapshot", error);
    let whereSql = Prisma.sql`WHERE "userId" = ${input.userId} AND "provider"::text = ${input.provider}`;
    if (typeof input.lectureSeq === "number") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "lectureSeq" = ${input.lectureSeq}`);
    }
    if (input.lectureSeqs && input.lectureSeqs.length > 0) {
      whereSql = appendSql(whereSql, Prisma.sql`AND "lectureSeq" IN (${Prisma.join(input.lectureSeqs)})`);
    }
    if (input.status) {
      whereSql = appendSql(whereSql, Prisma.sql`AND "status"::text = ${input.status}`);
    }

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      userId: string;
      provider: string | null;
      lectureSeq: number;
      externalLectureId: string | null;
      title: string;
      instructor: string | null;
      progressPercent: number | bigint | string;
      remainDays: number | bigint | string | null;
      recentLearnedAt: Date | null;
      periodStart: Date | null;
      periodEnd: Date | null;
      status: string;
      syncedAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }>>(Prisma.sql`
      SELECT
        "id",
        "userId",
        "provider"::text AS "provider",
        "lectureSeq",
        "externalLectureId",
        "title",
        "instructor",
        "progressPercent",
        "remainDays",
        "recentLearnedAt",
        "periodStart",
        "periodEnd",
        "status"::text AS "status",
        "syncedAt",
        "createdAt",
        "updatedAt"
      FROM "CourseSnapshot"
      ${whereSql}
      ${buildCourseSnapshotOrderSql(input.orderBy)}
    `);

    return rows.map((row) => normalizeCourseSnapshotRow(row, input.provider));
  }
}

async function countCourseNotices(input: {
  userId: string;
  provider: PortalProvider;
  lectureSeq?: number;
  isRead?: boolean;
  bodyText?: string;
}): Promise<number> {
  const baseWhere = {
    userId: input.userId,
    ...(typeof input.lectureSeq === "number" ? { lectureSeq: input.lectureSeq } : {}),
    ...(typeof input.isRead === "boolean" ? { isRead: input.isRead } : {}),
    ...(typeof input.bodyText === "string" ? { bodyText: input.bodyText } : {}),
  };

  try {
    return await withProviderCompatibility(
      input.userId,
      input.provider,
      () => prisma.courseNotice.count({
        where: {
          ...baseWhere,
          provider: input.provider,
        },
      }),
      () => prisma.courseNotice.count({ where: baseWhere }),
      0,
    );
  } catch (error) {
    warnDashboardRawReadFallback("course notice count", error);
    let whereSql = Prisma.sql`WHERE "userId" = ${input.userId} AND "provider"::text = ${input.provider}`;
    if (typeof input.lectureSeq === "number") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "lectureSeq" = ${input.lectureSeq}`);
    }
    if (typeof input.isRead === "boolean") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "isRead" = ${input.isRead}`);
    }
    if (typeof input.bodyText === "string") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "bodyText" = ${input.bodyText}`);
    }
    const rows = await prisma.$queryRaw<Array<{ count: number | bigint | string }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM "CourseNotice"
      ${whereSql}
    `);
    return toSafeNumber(rows[0]?.count, 0);
  }
}

async function loadCourseNoticeCountsByLecture(input: {
  userId: string;
  provider: PortalProvider;
  isRead?: boolean;
}): Promise<CourseNoticeCountGroup[]> {
  try {
    return await withProviderCompatibility(
      input.userId,
      input.provider,
      () => groupCourseNoticesByLecture({ userId: input.userId, provider: input.provider, isRead: input.isRead }),
      () => groupCourseNoticesByLecture({ userId: input.userId, isRead: input.isRead }),
      [] as CourseNoticeCountGroup[],
    );
  } catch (error) {
    warnDashboardRawReadFallback("course notice group", error);
    let whereSql = Prisma.sql`WHERE "userId" = ${input.userId} AND "provider"::text = ${input.provider}`;
    if (typeof input.isRead === "boolean") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "isRead" = ${input.isRead}`);
    }
    const rows = await prisma.$queryRaw<Array<{ lectureSeq: number; count: number | bigint | string }>>(Prisma.sql`
      SELECT
        "lectureSeq",
        COUNT(*)::int AS "count"
      FROM "CourseNotice"
      ${whereSql}
      GROUP BY "lectureSeq"
    `);
    return rows.map((row) => ({
      lectureSeq: row.lectureSeq,
      _count: { _all: toSafeNumber(row.count, 0) },
    }));
  }
}

async function loadCourseNoticeSamples(input: {
  userId: string;
  provider: PortalProvider;
  lectureSeq?: number;
  limit: number;
}): Promise<CourseNoticeSampleRow[]> {
  try {
    return await withProviderCompatibility(
      input.userId,
      input.provider,
      () => prisma.courseNotice.findMany({
        where: {
          userId: input.userId,
          provider: input.provider,
          ...(typeof input.lectureSeq === "number" ? { lectureSeq: input.lectureSeq } : {}),
        },
        take: input.limit,
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
      () => prisma.courseNotice.findMany({
        where: {
          userId: input.userId,
          ...(typeof input.lectureSeq === "number" ? { lectureSeq: input.lectureSeq } : {}),
        },
        take: input.limit,
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
      [] as CourseNoticeSampleRow[],
    );
  } catch (error) {
    warnDashboardRawReadFallback("course notice sample", error);
    let whereSql = Prisma.sql`WHERE "userId" = ${input.userId} AND "provider"::text = ${input.provider}`;
    if (typeof input.lectureSeq === "number") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "lectureSeq" = ${input.lectureSeq}`);
    }
    return prisma.$queryRaw<Array<CourseNoticeSampleRow>>(Prisma.sql`
      SELECT
        "id",
        "lectureSeq",
        "title",
        "postedAt",
        "bodyText",
        "updatedAt"
      FROM "CourseNotice"
      ${whereSql}
      ORDER BY "updatedAt" DESC
      LIMIT ${input.limit}
    `);
  }
}

async function fetchLearningTasksRaw(input: {
  userId: string;
  provider: PortalProvider;
  lectureSeq?: number;
  dueAtGte?: Date;
  dueAtLte?: Date;
  limit?: number;
  orderBy?: "dueAtAsc" | "lectureWeekLessonAsc";
}): Promise<Array<LearningTaskRow & { activityType: LearningTaskActivityType; state: LearningTaskState }>> {
  const sharedWhere = {
    userId: input.userId,
    ...(typeof input.lectureSeq === "number" ? { lectureSeq: input.lectureSeq } : {}),
    ...(input.dueAtGte || input.dueAtLte
      ? {
        dueAt: {
          ...(input.dueAtGte ? { gte: input.dueAtGte } : {}),
          ...(input.dueAtLte ? { lte: input.dueAtLte } : {}),
        },
      }
      : {}),
  };
  const sharedArgs = {
    orderBy: input.orderBy === "lectureWeekLessonAsc"
      ? [
        { lectureSeq: "asc" as const },
        { weekNo: "asc" as const },
        { lessonNo: "asc" as const },
      ]
      : [{ dueAt: "asc" as const }],
    ...(typeof input.limit === "number" ? { take: Math.max(1, Math.floor(input.limit)) } : {}),
    select: {
      lectureSeq: true,
      courseContentsSeq: true,
      weekNo: true,
      lessonNo: true,
      activityType: true,
      state: true,
      requiredSeconds: true,
      learnedSeconds: true,
      availableFrom: true,
      dueAt: true,
    },
  };
  let rows: Array<LearningTaskRow>;
  try {
    rows = await withProviderCompatibility(
      input.userId,
      input.provider,
      () => prisma.learningTask.findMany({
        where: {
          ...sharedWhere,
          provider: input.provider,
        },
        ...sharedArgs,
      }),
      () => prisma.learningTask.findMany({
        where: sharedWhere,
        ...sharedArgs,
      }),
      [] as Array<LearningTaskRow>,
    );
  } catch (error) {
    warnDashboardRawReadFallback("learning task", error);
    let whereSql = Prisma.sql`WHERE "userId" = ${input.userId} AND "provider"::text = ${input.provider}`;
    if (typeof input.lectureSeq === "number") {
      whereSql = appendSql(whereSql, Prisma.sql`AND "lectureSeq" = ${input.lectureSeq}`);
    }
    if (input.dueAtGte) {
      whereSql = appendSql(whereSql, Prisma.sql`AND "dueAt" >= ${input.dueAtGte}`);
    }
    if (input.dueAtLte) {
      whereSql = appendSql(whereSql, Prisma.sql`AND "dueAt" <= ${input.dueAtLte}`);
    }

    const orderBySql = input.orderBy === "lectureWeekLessonAsc"
      ? Prisma.sql`ORDER BY "lectureSeq" ASC, "weekNo" ASC, "lessonNo" ASC`
      : Prisma.sql`ORDER BY "dueAt" ASC NULLS LAST, "lectureSeq" ASC, "weekNo" ASC, "lessonNo" ASC`;
    const limitSql = typeof input.limit === "number"
      ? Prisma.sql`LIMIT ${Math.max(1, Math.floor(input.limit))}`
      : Prisma.empty;

    rows = await prisma.$queryRaw<Array<LearningTaskRow>>(Prisma.sql`
      SELECT
        "lectureSeq",
        "courseContentsSeq",
        "weekNo",
        "lessonNo",
        "activityType"::text AS "activityType",
        "state"::text AS "state",
        "requiredSeconds",
        "learnedSeconds",
        "availableFrom",
        "dueAt"
      FROM "LearningTask"
      ${whereSql}
      ${orderBySql}
      ${limitSql}
    `);
  }

  return rows.map((row) => normalizeLearningTaskRow({
    ...row,
    activityType: row.activityType,
    state: row.state,
  }));
}

function mapNoticeCountsByLecture(
  rows: CourseNoticeCountGroup[],
): Map<number, number> {
  return new Map(rows.map((row) => [row.lectureSeq, row._count._all]));
}

function groupCourseNoticesByLecture(where: {
  userId: string;
  provider?: PortalProvider;
  isRead?: boolean;
}): Promise<CourseNoticeCountGroup[]> {
  return prisma.courseNotice.groupBy({
    by: ["lectureSeq"],
    where,
    _count: { _all: true },
  } as never) as Promise<CourseNoticeCountGroup[]>;
}

function normalizeCyberCampusCourseTitle(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function getStaleCyberCampusLectureSeqs(userId: string): Promise<Set<number>> {
  const rows = await loadCourseSnapshots({
    userId,
    provider: "CYBER_CAMPUS",
  });

  const rowsByTitle = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = normalizeCyberCampusCourseTitle(row.title);
    if (!key) continue;
    const list = rowsByTitle.get(key) ?? [];
    list.push(row);
    rowsByTitle.set(key, list);
  }

  const staleLectureSeqs = new Set<number>();
  for (const duplicates of rowsByTitle.values()) {
    const hasCurrentExternalLectureId = duplicates.some((row) => (row.externalLectureId ?? "").trim().length > 0);
    if (!hasCurrentExternalLectureId) continue;

    for (const row of duplicates) {
      if ((row.externalLectureId ?? "").trim().length > 0) continue;
      staleLectureSeqs.add(row.lectureSeq);
    }
  }

  return staleLectureSeqs;
}

function filterOutStaleCyberCampusLectureSeqs<T extends { lectureSeq: number }>(
  rows: T[],
  staleLectureSeqs: Set<number>,
): T[] {
  if (staleLectureSeqs.size === 0) return rows;
  return rows.filter((row) => !staleLectureSeqs.has(row.lectureSeq));
}

export function combineDashboardSummaries(
  byProvider: Record<PortalProvider, DashboardSummary>,
): DashboardSummary {
  const summaries = PORTAL_PROVIDERS.map((provider) => byProvider[provider]);
  const activeCourseCount = summaries.reduce((sum, item) => sum + item.activeCourseCount, 0);
  const weightedProgress = summaries.reduce((sum, item) => sum + (item.avgProgress * item.activeCourseCount), 0);
  const nextDeadlineAt = summaries
    .map((item) => item.nextDeadlineAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const lastSyncAt = summaries
    .map((item) => item.lastSyncAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const nextAutoSyncAt = summaries
    .map((item) => item.nextAutoSyncAt)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? getNextScheduledSyncAt(new Date());

  return {
    activeCourseCount,
    avgProgress: activeCourseCount > 0 ? weightedProgress / activeCourseCount : 0,
    unreadNoticeCount: summaries.reduce((sum, item) => sum + item.unreadNoticeCount, 0),
    upcomingDeadlines: summaries.reduce((sum, item) => sum + item.upcomingDeadlines, 0),
    urgentTaskCount: summaries.reduce((sum, item) => sum + item.urgentTaskCount, 0),
    nextDeadlineAt,
    lastSyncAt,
    nextAutoSyncAt,
    autoSyncIntervalHours: AUTO_SYNC_INTERVAL_HOURS,
    initialSyncRequired: summaries.some((item) => item.initialSyncRequired),
  };
}

export async function getDashboardSummaries(userId: string): Promise<Record<PortalProvider, DashboardSummary>> {
  const entries = await Promise.all(PORTAL_PROVIDERS.map(async (provider) => {
    try {
      return [provider, await getDashboardSummary(userId, provider)] as const;
    } catch (error) {
      console.error(`[dashboard] summary load failed for ${provider}`, error);
      return [provider, createEmptyDashboardSummary()] as const;
    }
  }));
  return Object.fromEntries(entries) as Record<PortalProvider, DashboardSummary>;
}

export async function getDashboardSummary(userId: string, provider: PortalProvider = "CU12"): Promise<DashboardSummary> {
  const now = new Date();
  const soon = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  const staleLectureSeqs = provider === "CYBER_CAMPUS"
    ? await getStaleCyberCampusLectureSeqs(userId)
    : new Set<number>();
  const upcomingWindowTasks = filterOutStaleCyberCampusLectureSeqs(
    await fetchLearningTasksRaw({
      userId,
      provider,
      dueAtGte: now,
      dueAtLte: soon,
      orderBy: "dueAtAsc",
    }),
    staleLectureSeqs,
  );
  const upcomingPendingTasks = upcomingWindowTasks.filter((task) => !isTaskCompletedByProgress(task));

  const [activeCourses, unreadNoticeCount, syncJobs, user] = await Promise.all([
    loadCourseSnapshots({
      userId,
      provider,
      status: CourseStatus.ACTIVE,
    }),
    countCourseNotices({
      userId,
      provider,
      isRead: false,
    }),
    prisma.jobQueue.findMany({
      where: {
        userId,
        type: "SYNC",
        status: {
          in: ["PENDING", "RUNNING", "SUCCEEDED"],
        },
      },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true, finishedAt: true, payload: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { isTestUser: true },
    }),
  ]);
  const filteredActiveCourses = filterOutStaleCyberCampusLectureSeqs(activeCourses, staleLectureSeqs);
  const activeCourseCount = filteredActiveCourses.length;
  const avgProgress = activeCourseCount > 0
    ? filteredActiveCourses.reduce((sum, course) => sum + course.progressPercent, 0) / activeCourseCount
    : 0;

  const providerSyncJobs = syncJobs.filter((job) => getJobPayloadProvider(job.payload) === provider);
  const lastSync = providerSyncJobs
    .filter((job) => job.status === "SUCCEEDED" && job.finishedAt)
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))[0] ?? null;
  const recentSync = providerSyncJobs[0] ?? null;
  const nextAutoSyncAt = getNextAutoSyncAt(now, recentSync?.createdAt ?? null);
  const nextDeadlineTask = upcomingPendingTasks[0] ?? null;

  return {
    activeCourseCount,
    avgProgress,
    unreadNoticeCount,
    upcomingDeadlines: upcomingPendingTasks.length,
    urgentTaskCount: upcomingPendingTasks.length,
    nextDeadlineAt: nextDeadlineTask?.dueAt ?? null,
    lastSyncAt: lastSync?.finishedAt ?? null,
    nextAutoSyncAt,
    autoSyncIntervalHours: AUTO_SYNC_INTERVAL_HOURS,
    initialSyncRequired: !lastSync && !user?.isTestUser,
  };
}

export async function getCourses(userId: string, provider: PortalProvider = "CU12") {
  const now = new Date();
  const nowMs = now.getTime();
  const staleLectureSeqs = provider === "CYBER_CAMPUS"
    ? await getStaleCyberCampusLectureSeqs(userId)
    : new Set<number>();

  const [courses, tasks, noticeCounts, unreadNoticeCounts] = await Promise.all([
    loadCourseSnapshots({
      userId,
      provider,
      orderBy: "statusRemainDaysTitle",
    }),
    fetchLearningTasksRaw({
      userId,
      provider,
      orderBy: "lectureWeekLessonAsc",
    }),
    loadCourseNoticeCountsByLecture({
      userId,
      provider,
    }),
    loadCourseNoticeCountsByLecture({
      userId,
      provider,
      isRead: false,
    }),
  ]);
  const filteredCourses = filterOutStaleCyberCampusLectureSeqs(courses, staleLectureSeqs);
  const filteredTasks = filterOutStaleCyberCampusLectureSeqs(tasks, staleLectureSeqs);

  const grouped = new Map<number, typeof tasks>();
  for (const task of filteredTasks) {
    const list = grouped.get(task.lectureSeq) ?? [];
    list.push(task);
    grouped.set(task.lectureSeq, list);
  }

  const noticeCountByLectureSeq = mapNoticeCountsByLecture(noticeCounts);
  const unreadNoticeCountByLectureSeq = new Map<number, number>(unreadNoticeCounts.map((row) => [row.lectureSeq, row._count._all]));

  return filteredCourses.map((course) => {
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

export async function getUpcomingDeadlines(userId: string, limit = 30, provider: PortalProvider) {
  const now = new Date();
  const staleLectureSeqs = provider === "CYBER_CAMPUS"
    ? await getStaleCyberCampusLectureSeqs(userId)
    : new Set<number>();
  const tasksRaw = filterOutStaleCyberCampusLectureSeqs(
    await fetchLearningTasksRaw({
      userId,
      provider,
      dueAtGte: now,
      limit: Math.min(Math.max(limit, 1), 100),
      orderBy: "dueAtAsc",
    }),
    staleLectureSeqs,
  );
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
    ? await loadCourseSnapshots({
      userId,
      provider,
      lectureSeqs: seqs,
    })
    : [];
  const titleBySeq = new Map(courses.map((course) => [course.lectureSeq, course.title]));

  return tasks.map((task) => ({
    lectureSeq: task.lectureSeq,
    courseContentsSeq: task.courseContentsSeq,
    weekNo: task.weekNo,
    lessonNo: task.lessonNo,
    activityType: task.activityType,
    isCompleted: task.isCompleted,
    availableFrom: task.availableFrom,
    dueAt: task.dueAt,
    courseTitle: titleBySeq.get(task.lectureSeq) ?? `강좌 ${task.lectureSeq}`,
    remainingSeconds: Math.max(0, task.requiredSeconds - task.learnedSeconds),
    daysLeft: task.dueAt ? daysUntil(task.dueAt, now) : null,
  }));
}

export async function getDashboardDiagnostics(
  userId: string,
  provider: PortalProvider = "CU12",
  options?: {
    lectureSeq?: number;
    sampleLimit?: number;
  },
) {
  const now = new Date();
  const nowMs = now.getTime();
  const sampleLimit = Math.min(Math.max(options?.sampleLimit ?? 20, 1), 100);
  const staleLectureSeqs = provider === "CYBER_CAMPUS"
    ? await getStaleCyberCampusLectureSeqs(userId)
    : new Set<number>();

  const [courses, tasks, totalNoticeCount, emptyNoticeCount, noticeSamples, recentJobs] = await Promise.all([
    loadCourseSnapshots({
      userId,
      provider,
      lectureSeq: options?.lectureSeq,
      orderBy: "lectureSeqAsc",
    }),
    fetchLearningTasksRaw({
      userId,
      provider,
      lectureSeq: options?.lectureSeq,
      orderBy: "lectureWeekLessonAsc",
    }),
    countCourseNotices({
      userId,
      provider,
      lectureSeq: options?.lectureSeq,
    }),
    countCourseNotices({
      userId,
      provider,
      lectureSeq: options?.lectureSeq,
      bodyText: "",
    }),
    loadCourseNoticeSamples({
      userId,
      provider,
      lectureSeq: options?.lectureSeq,
      limit: sampleLimit,
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
  const filteredCourses = filterOutStaleCyberCampusLectureSeqs(courses, staleLectureSeqs);
  const filteredTasks = filterOutStaleCyberCampusLectureSeqs(tasks, staleLectureSeqs);

  const titleByLectureSeq = new Map(filteredCourses.map((course) => [course.lectureSeq, course.title]));
  const groupedTasks = new Map<number, typeof tasks>();
  for (const task of filteredTasks) {
    const list = groupedTasks.get(task.lectureSeq) ?? [];
    list.push(task);
    groupedTasks.set(task.lectureSeq, list);
  }

  const lectureSeqs = Array.from(
    new Set([
      ...filteredCourses.map((course) => course.lectureSeq),
      ...filteredTasks.map((task) => task.lectureSeq),
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

  const pendingTaskCount = filteredTasks.filter((task) => !isTaskCompletedByProgress(task)).length;
  const pendingWithDueAtCount = filteredTasks.filter(
    (task) => !isTaskCompletedByProgress(task) && Boolean(task.dueAt),
  ).length;
  const pendingWithWindowCount = filteredTasks.filter(
    (task) => !isTaskCompletedByProgress(task) && Boolean(task.dueAt || task.availableFrom),
  ).length;
  const pendingWithoutWindowCount = filteredTasks.filter(
    (task) => !isTaskCompletedByProgress(task) && !task.dueAt && !task.availableFrom,
  ).length;

  return {
    generatedAt: now.toISOString(),
    summary: {
      courseCount: filteredCourses.length,
      taskCount: filteredTasks.length,
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

export async function getNotices(userId: string, lectureSeq: number, provider: PortalProvider = "CU12") {
  const rows = await withProviderCompatibility(
    userId,
    provider,
    () => prisma.courseNotice.findMany({
      where: { userId, provider, lectureSeq },
      orderBy: [{ isRead: "asc" }, { postedAt: "desc" }],
    }),
    () => prisma.courseNotice.findMany({
      where: { userId, lectureSeq },
      orderBy: [{ isRead: "asc" }, { postedAt: "desc" }],
    }),
    [] as CourseNoticeRow[],
  );
  return dedupeNoticeRows(rows);
}

export async function getActivity(
  userId: string,
  provider: PortalProvider = "CU12",
  limit = 50,
): Promise<DashboardActivityItem[]> {
  const take = Math.min(Math.max(limit, 1), 100);
  const now = new Date();
  const urgentUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [notices, notifications, messages, urgentTasks] = await Promise.all([
    withProviderCompatibility(
      userId,
      provider,
      () => prisma.courseNotice.findMany({
        where: { userId, provider, isRead: false },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: Math.min(take, 30),
        select: { id: true, provider: true, title: true, bodyText: true, postedAt: true, createdAt: true, isRead: true },
      }),
      () => prisma.courseNotice.findMany({
        where: { userId, isRead: false },
        orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
        take: Math.min(take, 30),
        select: { id: true, provider: true, title: true, bodyText: true, postedAt: true, createdAt: true, isRead: true },
      }),
      [],
    ),
    withProviderCompatibility(
      userId,
      provider,
      () => prisma.notificationEvent.findMany({
        where: { userId, provider, isArchived: false },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take,
        select: {
          id: true,
          provider: true,
          courseTitle: true,
          category: true,
          message: true,
          occurredAt: true,
          createdAt: true,
          isUnread: true,
          isCanceled: true,
          isArchived: true,
        },
      }),
      () => prisma.notificationEvent.findMany({
        where: { userId, isArchived: false },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take,
        select: {
          id: true,
          provider: true,
          courseTitle: true,
          category: true,
          message: true,
          occurredAt: true,
          createdAt: true,
          isUnread: true,
          isCanceled: true,
          isArchived: true,
        },
      }),
      [],
    ),
    withProviderCompatibility(
      userId,
      provider,
      () => prisma.portalMessage.findMany({
        where: { userId, provider, isArchived: false },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take,
        select: {
          id: true,
          provider: true,
          title: true,
          senderName: true,
          bodyText: true,
          sentAt: true,
          createdAt: true,
          isRead: true,
          isArchived: true,
        },
      }),
      () => prisma.portalMessage.findMany({
        where: { userId, isArchived: false },
        orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
        take,
        select: {
          id: true,
          provider: true,
          title: true,
          senderName: true,
          bodyText: true,
          sentAt: true,
          createdAt: true,
          isRead: true,
          isArchived: true,
        },
      }),
      [],
    ),
    withProviderCompatibility(
      userId,
      provider,
      () => prisma.learningTask.findMany({
        where: { userId, provider, state: "PENDING", dueAt: { gte: now, lte: urgentUntil } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: { id: true, provider: true, lectureSeq: true, weekNo: true, lessonNo: true, dueAt: true, createdAt: true },
      }),
      () => prisma.learningTask.findMany({
        where: { userId, state: "PENDING", dueAt: { gte: now, lte: urgentUntil } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 20,
        select: { id: true, provider: true, lectureSeq: true, weekNo: true, lessonNo: true, dueAt: true, createdAt: true },
      }),
      [],
    ),
  ]);

  const lectureSeqs = Array.from(new Set(urgentTasks.map((task) => task.lectureSeq)));
  const titleRows = lectureSeqs.length > 0
    ? await withProviderCompatibility(
      userId,
      provider,
      () => prisma.courseSnapshot.findMany({
        where: { userId, provider, lectureSeq: { in: lectureSeqs } },
        select: { lectureSeq: true, title: true },
      }),
      () => prisma.courseSnapshot.findMany({
        where: { userId, lectureSeq: { in: lectureSeqs } },
        select: { lectureSeq: true, title: true },
      }),
      [],
    )
    : [];
  const titleBySeq = new Map(titleRows.map((row) => [row.lectureSeq, row.title]));

  const activities: DashboardActivityItem[] = [
    ...notices.map((notice) => ({
      id: `notice:${notice.provider}:${notice.id}`,
      sourceId: notice.id,
      kind: "NOTICE" as const,
      provider: notice.provider,
      title: notice.title,
      courseTitle: notice.title,
      message: notice.bodyText,
      occurredAt: notice.postedAt,
      createdAt: notice.createdAt,
      isUnread: !notice.isRead,
      isArchived: false,
      needsAttention: false,
    })),
    ...notifications.map((notification) => ({
      id: `notification:${notification.provider}:${notification.id}`,
      sourceId: notification.id,
      kind: "NOTIFICATION" as const,
      provider: notification.provider,
      title: notification.courseTitle || notification.category || "Portal notification",
      courseTitle: notification.courseTitle || notification.category || "Portal notification",
      message: notification.message,
      occurredAt: notification.occurredAt,
      createdAt: notification.createdAt,
      isUnread: notification.isUnread,
      isArchived: notification.isArchived,
      needsAttention: isAttentionNotification(notification),
    })),
    ...messages.map((message) => ({
      id: `message:${message.provider}:${message.id}`,
      sourceId: message.id,
      kind: "MESSAGE" as const,
      provider: message.provider,
      title: message.title,
      courseTitle: message.title,
      message: message.bodyText || message.senderName || "",
      occurredAt: message.sentAt,
      createdAt: message.createdAt,
      isUnread: !message.isRead,
      isArchived: message.isArchived,
      needsAttention: !message.isRead,
    })),
    ...urgentTasks.map((task) => ({
      id: `system:${task.provider}:${task.id}`,
      sourceId: task.id,
      kind: "SYSTEM" as const,
      provider: task.provider,
      title: "Urgent deadline",
      courseTitle: titleBySeq.get(task.lectureSeq) ?? `Course ${task.lectureSeq}`,
      message: `${titleBySeq.get(task.lectureSeq) ?? `Course ${task.lectureSeq}`} - week ${task.weekNo}, lesson ${task.lessonNo}`,
      occurredAt: task.dueAt,
      createdAt: task.createdAt,
      isUnread: true,
      isArchived: false,
      needsAttention: true,
    })),
  ];

  return activities
    .sort((a, b) => {
      const attentionDelta = Number(b.needsAttention) - Number(a.needsAttention);
      if (attentionDelta !== 0) return attentionDelta;
      return normalizeActivityDate(b.occurredAt, b.createdAt).getTime()
        - normalizeActivityDate(a.occurredAt, a.createdAt).getTime();
    })
    .slice(0, take);
}

export async function getNotifications(
  userId: string,
  provider: PortalProvider = "CU12",
  options?: {
    unreadOnly?: boolean;
    includeArchived?: boolean;
    historyOnly?: boolean;
    limit?: number;
  },
) {
  const historyOnly = options?.historyOnly ?? false;

  return withProviderCompatibility(
    userId,
    provider,
    () => prisma.notificationEvent.findMany({
      where: {
        userId,
        provider,
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
    }),
    () => prisma.notificationEvent.findMany({
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
    }),
    [],
  );
}

export async function getMessages(
  userId: string,
  provider: PortalProvider = "CU12",
  limit = 50,
) {
  const portalMessageStore = getPortalMessageStore();
  if (!portalMessageStore) {
    return [];
  }

  return withProviderCompatibility(
    userId,
    provider,
    () => portalMessageStore.findMany({
      where: { userId, provider, isArchived: false },
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 100),
    }) as Promise<Array<Prisma.PortalMessageGetPayload<object>>>,
    () => portalMessageStore.findMany({
      where: { userId, isArchived: false },
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 100),
    }) as Promise<Array<Prisma.PortalMessageGetPayload<object>>>,
    [],
  );
}
