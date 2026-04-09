import type {
  CourseNotice,
  CourseState,
  LearningTask,
  NotificationEvent,
  PortalMessage,
  PortalProvider,
} from "@cu12/core";
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

function normalizeNoticeFingerprintText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCourseFingerprintText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractNoticeSeqFromKey(noticeKey: string): string | null {
  return noticeKey.match(/:seq:(\d+)/)?.[1] ?? null;
}

function toNoticeTimestamp(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : toDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
}

function toNoticeDateKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const timestamp = toNoticeTimestamp(value);
  if (timestamp <= 0) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildNoticeFingerprint(input: {
  lectureSeq: number;
  noticeKey: string;
  title: string;
  author: string | null;
  postedAt: string | Date | null;
  bodyText: string;
}): string {
  const title = normalizeNoticeFingerprintText(input.title);
  const author = normalizeNoticeFingerprintText(input.author);
  const postedAt = toNoticeDateKey(input.postedAt);
  if (title && postedAt) {
    return `${input.lectureSeq}:meta:${title}|${postedAt}`;
  }

  const bodyHint = normalizeNoticeFingerprintText(input.bodyText).slice(0, 120);
  if (title && author) {
    return `${input.lectureSeq}:meta:${title}|${author}`;
  }
  if (title && bodyHint) {
    return `${input.lectureSeq}:meta:${title}|${bodyHint}`;
  }

  const noticeSeq = extractNoticeSeqFromKey(input.noticeKey);
  if (noticeSeq) {
    return `${input.lectureSeq}:seq:${noticeSeq}`;
  }
  return `${input.lectureSeq}:meta:${title}|${author}|${bodyHint}`;
}

function pickLongerBody(current: string, candidate: string): string {
  return candidate.trim().length > current.trim().length ? candidate : current;
}

function isNoticePreferred(
  candidate: {
    noticeKey: string;
    noticeSeq?: string;
    bodyText: string;
    postedAt: string | Date | null;
    syncedAt: string | Date | null;
    updatedAt?: Date | null;
  },
  current: {
    noticeKey: string;
    noticeSeq?: string;
    bodyText: string;
    postedAt: string | Date | null;
    syncedAt: string | Date | null;
    updatedAt?: Date | null;
  },
): boolean {
  const candidateSeq = candidate.noticeSeq ?? extractNoticeSeqFromKey(candidate.noticeKey);
  const currentSeq = current.noticeSeq ?? extractNoticeSeqFromKey(current.noticeKey);

  if (Boolean(candidateSeq) !== Boolean(currentSeq)) {
    return Boolean(candidateSeq);
  }

  const candidateBodyLen = candidate.bodyText.trim().length;
  const currentBodyLen = current.bodyText.trim().length;
  if (candidateBodyLen !== currentBodyLen) {
    return candidateBodyLen > currentBodyLen;
  }

  const candidatePostedAt = toNoticeTimestamp(candidate.postedAt);
  const currentPostedAt = toNoticeTimestamp(current.postedAt);
  if (candidatePostedAt !== currentPostedAt) {
    return candidatePostedAt > currentPostedAt;
  }

  const candidateSyncedAt = toNoticeTimestamp(candidate.syncedAt);
  const currentSyncedAt = toNoticeTimestamp(current.syncedAt);
  if (candidateSyncedAt !== currentSyncedAt) {
    return candidateSyncedAt > currentSyncedAt;
  }

  const candidateUpdatedAt = candidate.updatedAt?.getTime() ?? 0;
  const currentUpdatedAt = current.updatedAt?.getTime() ?? 0;
  return candidateUpdatedAt > currentUpdatedAt;
}

function dedupeIncomingNotices(notices: CourseNotice[]): CourseNotice[] {
  const byFingerprint = new Map<string, CourseNotice>();

  for (const notice of notices) {
    const fingerprint = buildNoticeFingerprint({
      lectureSeq: notice.lectureSeq,
      noticeKey: notice.noticeKey,
      title: notice.title,
      author: notice.author,
      postedAt: notice.postedAt,
      bodyText: notice.bodyText,
    });
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, notice);
      continue;
    }

    const preferred = isNoticePreferred(notice, existing) ? notice : existing;
    const merged: CourseNotice = {
      ...preferred,
      noticeSeq: preferred.noticeSeq ?? existing.noticeSeq ?? notice.noticeSeq,
      bodyText: pickLongerBody(existing.bodyText, notice.bodyText),
      isNew: existing.isNew || notice.isNew,
      syncedAt: toNoticeTimestamp(existing.syncedAt) >= toNoticeTimestamp(notice.syncedAt)
        ? existing.syncedAt
        : notice.syncedAt,
    };
    byFingerprint.set(fingerprint, merged);
  }

  return [...byFingerprint.values()];
}

async function cleanupDuplicateCourseNotices(
  userId: string,
  provider: PortalProvider,
  lectureSeqs: number[],
): Promise<void> {
  const targets = Array.from(new Set(lectureSeqs.filter((lectureSeq) => Number.isFinite(lectureSeq) && lectureSeq > 0)));
  if (targets.length === 0) return;

  const rows = await prisma.courseNotice.findMany({
    where: { userId, provider, lectureSeq: { in: targets } },
    select: {
      id: true,
      lectureSeq: true,
      noticeKey: true,
      title: true,
      author: true,
      postedAt: true,
      bodyText: true,
      isRead: true,
      isNew: true,
      syncedAt: true,
      updatedAt: true,
    },
  });

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = buildNoticeFingerprint({
      lectureSeq: row.lectureSeq,
      noticeKey: row.noticeKey,
      title: row.title,
      author: row.author,
      postedAt: row.postedAt,
      bodyText: row.bodyText,
    });
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  for (const duplicates of grouped.values()) {
    if (duplicates.length <= 1) continue;

    let keeper = duplicates[0];
    for (const row of duplicates.slice(1)) {
      if (isNoticePreferred(row, keeper)) {
        keeper = row;
      }
    }

    const mergedBody = duplicates.reduce((best, row) => pickLongerBody(best, row.bodyText), keeper.bodyText);
    const mergedIsRead = duplicates.every((row) => row.isRead);
    const mergedIsNew = duplicates.some((row) => row.isNew);
    const mergedSyncedAtMs = Math.max(...duplicates.map((row) => row.syncedAt.getTime()));
    const mergedSyncedAt = new Date(mergedSyncedAtMs);

    await runWithPrismaRetry(() =>
      prisma.courseNotice.update({
        where: { id: keeper.id },
        data: {
          bodyText: mergedBody,
          isRead: mergedIsRead,
          isNew: mergedIsNew,
          syncedAt: mergedSyncedAt,
        },
      }),
    );

    const duplicateIds = duplicates.filter((row) => row.id !== keeper.id).map((row) => row.id);
    if (duplicateIds.length > 0) {
      await runWithPrismaRetry(() =>
        prisma.courseNotice.deleteMany({
          where: {
            userId,
            provider,
            id: { in: duplicateIds },
          },
        }),
      );
    }
  }
}

async function cleanupLegacyCyberCampusCourseSnapshots(
  userId: string,
  provider: PortalProvider,
  titles: string[],
): Promise<void> {
  if (provider !== "CYBER_CAMPUS") return;

  const normalizedTitles = Array.from(
    new Set(
      titles
        .map((title) => normalizeCourseFingerprintText(title))
        .filter((title) => title.length > 0),
    ),
  );
  if (normalizedTitles.length === 0) return;

  const rows = await prisma.courseSnapshot.findMany({
    where: {
      userId,
      provider,
    },
    select: {
      id: true,
      lectureSeq: true,
      title: true,
      externalLectureId: true,
      syncedAt: true,
      updatedAt: true,
    },
  });
  const filteredRows = rows.filter((row) => normalizedTitles.includes(normalizeCourseFingerprintText(row.title)));
  if (filteredRows.length === 0) return;

  const taskRows = await prisma.learningTask.findMany({
    where: {
      userId,
      provider,
      lectureSeq: { in: filteredRows.map((row) => row.lectureSeq) },
    },
    select: {
      id: true,
      lectureSeq: true,
      courseContentsSeq: true,
    },
  });
  const taskCountByLectureSeq = new Map<number, number>();
  const taskIdsByLectureSeq = new Map<number, string[]>();
  const taskContentsByLectureSeq = new Map<number, Set<number>>();
  for (const row of taskRows) {
    taskCountByLectureSeq.set(row.lectureSeq, (taskCountByLectureSeq.get(row.lectureSeq) ?? 0) + 1);
    const ids = taskIdsByLectureSeq.get(row.lectureSeq) ?? [];
    ids.push(row.id);
    taskIdsByLectureSeq.set(row.lectureSeq, ids);
    const contents = taskContentsByLectureSeq.get(row.lectureSeq) ?? new Set<number>();
    contents.add(row.courseContentsSeq);
    taskContentsByLectureSeq.set(row.lectureSeq, contents);
  }

  const rowsByTitle = new Map<string, typeof filteredRows>();
  for (const row of filteredRows) {
    const key = normalizeCourseFingerprintText(row.title);
    const list = rowsByTitle.get(key) ?? [];
    list.push(row);
    rowsByTitle.set(key, list);
  }

  for (const duplicates of rowsByTitle.values()) {
    const currentRows = duplicates.filter((row) => (row.externalLectureId ?? "").trim().length > 0);
    if (currentRows.length === 0) continue;
    const keeper = currentRows
      .slice()
      .sort((a, b) =>
        ((taskCountByLectureSeq.get(b.lectureSeq) ?? 0) - (taskCountByLectureSeq.get(a.lectureSeq) ?? 0))
        || (b.syncedAt.getTime() - a.syncedAt.getTime())
        || (b.updatedAt.getTime() - a.updatedAt.getTime()),
      )[0];
    if (!keeper) continue;

    const keeperTaskContents = taskContentsByLectureSeq.get(keeper.lectureSeq) ?? new Set<number>();
    const staleRows = duplicates.filter((row) => (row.externalLectureId ?? "").trim().length === 0);

    for (const staleRow of staleRows) {
      const staleTaskIds = taskIdsByLectureSeq.get(staleRow.lectureSeq) ?? [];
      const staleTaskContents = taskContentsByLectureSeq.get(staleRow.lectureSeq) ?? new Set<number>();
      const canDeleteStaleTasks =
        staleTaskIds.length === 0
        || (
          keeperTaskContents.size > 0
          && [...staleTaskContents].every((courseContentsSeq) => keeperTaskContents.has(courseContentsSeq))
        );
      if (!canDeleteStaleTasks) continue;

      if (staleTaskIds.length > 0) {
        await runWithPrismaRetry(() =>
          prisma.learningTask.deleteMany({
            where: {
              userId,
              provider,
              id: { in: staleTaskIds },
            },
          }),
        );
      }

      await runWithPrismaRetry(() =>
        prisma.courseSnapshot.deleteMany({
          where: {
            userId,
            provider,
            id: staleRow.id,
          },
        }),
      );
    }
  }
}

export interface PersistSnapshotResult {
  newNoticeCount: number;
  newNotificationCount: number;
  newUnreadNotificationCount: number;
  newMessageCount: number;
  unreadMessageCount: number;
  newNotices: Array<{
    lectureSeq: number;
    noticeKey: string;
    title: string;
    author: string | null;
    postedAt: string | null;
    bodyText: string;
  }>;
  newUnreadNotifications: Array<{
    notifierSeq: string;
    courseTitle: string;
    category: string;
    message: string;
    occurredAt: string | null;
    isCanceled: boolean;
  }>;
  newMessages: Array<{
    messageSeq: string;
    title: string;
    senderName: string | null;
    sentAt: string | null;
  }>;
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
    provider: account.provider as PortalProvider,
    cu12Id: account.cu12Id,
    cu12Password: decryptSecret(account.encryptedPassword),
    campus: account.campus === "SONGSIN" ? "SONGSIN" : account.campus === "SONGSIM" ? "SONGSIM" : null,
    quizAutoSolveEnabled: account.quizAutoSolveEnabled,
  };
}

export async function getMandatoryMailRecipient(userId: string): Promise<string | null> {
  const subscription = await prisma.mailSubscription.findUnique({
    where: { userId },
    select: {
      email: true,
    },
  });

  const email = subscription?.email?.trim() ?? "";
  return email.length > 0 ? email : null;
}

export interface PortalSessionCookieState {
  name: string;
  value: string;
}

function decodePortalSessionCookieState(payload: string): PortalSessionCookieState[] {
  try {
    const raw = JSON.parse(decryptSecret(payload)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const name = (item as { name?: unknown }).name;
        const value = (item as { value?: unknown }).value;
        if (typeof name !== "string" || typeof value !== "string") return null;
        return { name, value };
      })
      .filter((item): item is PortalSessionCookieState => item !== null);
  } catch {
    return [];
  }
}

export async function getPortalSessionCookieState(userId: string, provider: PortalProvider) {
  const row = await prisma.portalSession.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
    select: {
      encryptedCookieState: true,
      status: true,
      expiresAt: true,
      lastVerifiedAt: true,
    },
  });
  if (!row) return null;

  return {
    status: row.status as "ACTIVE" | "EXPIRED" | "INVALID",
    expiresAt: row.expiresAt,
    lastVerifiedAt: row.lastVerifiedAt,
    cookieState: decodePortalSessionCookieState(row.encryptedCookieState),
  };
}

export async function invalidatePortalSession(userId: string, provider: PortalProvider) {
  await prisma.portalSession.updateMany({
    where: { userId, provider },
    data: {
      status: "INVALID",
      updatedAt: new Date(),
    },
  });
}

export async function getUserMailPreference(userId: string): Promise<MailPreference | null> {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        cu12Account: {
          select: {
            emailDigestEnabled: true,
          },
        },
      },
    }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  const accountDigestEnabled = user?.cu12Account?.emailDigestEnabled ?? true;

  if (!user?.email) {
    return null;
  }

  if (!subscription) {
    return {
      enabled: true,
      email: user.email,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: accountDigestEnabled,
      digestHour: 8,
    };
  }

  return {
    enabled: subscription.enabled,
    email: subscription.email,
    alertOnNotice: subscription.alertOnNotice,
    alertOnDeadline: subscription.alertOnDeadline,
    alertOnAutolearn: subscription.alertOnAutolearn,
    digestEnabled: subscription.digestEnabled && accountDigestEnabled,
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
  provider: PortalProvider,
  data: {
    courses: CourseState[];
    notices: CourseNotice[];
    notifications: NotificationEvent[];
    tasks: LearningTask[];
    messages?: PortalMessage[];
  },
): Promise<PersistSnapshotResult> {
  const notices = dedupeIncomingNotices(data.notices);
  const noticeKeys = Array.from(new Set(notices.map((notice) => notice.noticeKey)));
  const notifications = data.notifications.filter((event) => event.notifierSeq.trim().length > 0);
  const notifierSeqs = Array.from(new Set(notifications.map((event) => event.notifierSeq)));
  const messages = (data.messages ?? []).filter((event) => event.messageSeq.trim().length > 0);
  const messageSeqs = Array.from(new Set(messages.map((event) => event.messageSeq)));

  const [existingNoticeRows, existingNotificationRows, existingMessageRows] = await Promise.all([
    noticeKeys.length > 0
      ? prisma.courseNotice.findMany({
        where: { userId, provider, noticeKey: { in: noticeKeys } },
        select: { noticeKey: true },
      })
      : Promise.resolve([]),
    notifierSeqs.length > 0
      ? prisma.notificationEvent.findMany({
        where: { userId, provider, notifierSeq: { in: notifierSeqs } },
        select: {
          notifierSeq: true,
          isUnread: true,
          isArchived: true,
        },
      })
      : Promise.resolve([]),
    messageSeqs.length > 0
      ? prisma.portalMessage.findMany({
        where: { userId, provider, messageSeq: { in: messageSeqs } },
        select: {
          messageSeq: true,
          isRead: true,
        },
      })
      : Promise.resolve([]),
  ]);

  const existingNoticeSet = new Set(existingNoticeRows.map((row) => row.noticeKey));
  const existingNotificationSet = new Set(existingNotificationRows.map((row) => row.notifierSeq));
  const existingNotificationBySeq = new Map(
    existingNotificationRows.map((row) => [
      row.notifierSeq,
      {
        isUnread: row.isUnread,
        isArchived: row.isArchived,
      },
    ]),
  );
  const existingMessageSet = new Set(existingMessageRows.map((row) => row.messageSeq));
  const existingMessageBySeq = new Map(existingMessageRows.map((row) => [row.messageSeq, row.isRead]));

  let newNoticeCount = 0;
  let newNotificationCount = 0;
  let newUnreadNotificationCount = 0;
  let newMessageCount = 0;
  const newNotices: PersistSnapshotResult["newNotices"] = [];
  const newUnreadNotifications: PersistSnapshotResult["newUnreadNotifications"] = [];
  const newMessages: PersistSnapshotResult["newMessages"] = [];

  for (const course of data.courses) {
    await runWithPrismaRetry(() =>
      prisma.courseSnapshot.upsert({
        where: {
          userId_provider_lectureSeq: {
            userId,
            provider,
            lectureSeq: course.lectureSeq,
          },
        },
        update: {
          provider,
          externalLectureId: course.externalLectureId ?? null,
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
          provider,
          lectureSeq: course.lectureSeq,
          externalLectureId: course.externalLectureId ?? null,
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

  await cleanupLegacyCyberCampusCourseSnapshots(
    userId,
    provider,
    data.courses.map((course) => course.title),
  );

  for (const notice of notices) {
    const isNewRecord = !existingNoticeSet.has(notice.noticeKey);
    const normalizedBodyText = notice.bodyText?.trim();

    await runWithPrismaRetry(() =>
      prisma.courseNotice.upsert({
        where: {
          userId_provider_lectureSeq_noticeKey: {
            userId,
            provider,
            lectureSeq: notice.lectureSeq,
            noticeKey: notice.noticeKey,
          },
        },
        update: {
          provider,
          title: notice.title,
          author: notice.author,
          postedAt: toDate(notice.postedAt),
          isNew: notice.isNew,
          syncedAt: new Date(notice.syncedAt),
          ...(normalizedBodyText ? { bodyText: notice.bodyText } : {}),
        },
        create: {
          userId,
          provider,
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
      newNotices.push({
        lectureSeq: notice.lectureSeq,
        noticeKey: notice.noticeKey,
        title: notice.title,
        author: notice.author,
        postedAt: notice.postedAt,
        bodyText: notice.bodyText,
      });
    }
  }

  await cleanupDuplicateCourseNotices(userId, provider, data.courses.map((course) => course.lectureSeq));

  for (const event of notifications) {
    const isNewRecord = !existingNotificationSet.has(event.notifierSeq);
    const existing = existingNotificationBySeq.get(event.notifierSeq);
    const nextIsUnread = existing ? existing.isUnread && event.isUnread : event.isUnread;
    const nextIsArchived = existing?.isArchived ?? false;

    await runWithPrismaRetry(() =>
      prisma.notificationEvent.upsert({
        where: {
          userId_provider_notifierSeq: {
            userId,
            provider,
            notifierSeq: event.notifierSeq,
          },
        },
        update: {
          provider,
          courseTitle: event.courseTitle,
          category: event.category,
          message: event.message,
          occurredAt: toDate(event.occurredAt),
          isCanceled: event.isCanceled,
          isUnread: nextIsUnread,
          isArchived: nextIsArchived,
          syncedAt: new Date(event.syncedAt),
        },
        create: {
          userId,
          provider,
          notifierSeq: event.notifierSeq,
          courseTitle: event.courseTitle,
          category: event.category,
          message: event.message,
          occurredAt: toDate(event.occurredAt),
          isCanceled: event.isCanceled,
          isUnread: event.isUnread,
          isArchived: false,
          syncedAt: new Date(event.syncedAt),
        },
      }),
    );

    if (isNewRecord) {
      newNotificationCount += 1;
      if (event.isUnread) {
        newUnreadNotificationCount += 1;
        newUnreadNotifications.push({
          notifierSeq: event.notifierSeq,
          courseTitle: event.courseTitle,
          category: event.category,
          message: event.message,
          occurredAt: event.occurredAt,
          isCanceled: event.isCanceled,
        });
      }
    }

    existingNotificationSet.add(event.notifierSeq);
    existingNotificationBySeq.set(event.notifierSeq, {
      isUnread: nextIsUnread,
      isArchived: nextIsArchived,
    });
  }

  for (const event of messages) {
    const isNewRecord = !existingMessageSet.has(event.messageSeq);
    const existingIsRead = existingMessageBySeq.get(event.messageSeq);
    const nextIsRead = existingIsRead === undefined ? event.isRead : existingIsRead || event.isRead;

    await runWithPrismaRetry(() =>
      prisma.portalMessage.upsert({
        where: {
          userId_provider_messageSeq: {
            userId,
            provider,
            messageSeq: event.messageSeq,
          },
        },
        update: {
          title: event.title,
          senderId: event.senderId ?? null,
          senderName: event.senderName ?? null,
          bodyText: event.bodyText,
          sentAt: toDate(event.sentAt ?? null),
          isRead: nextIsRead,
          syncedAt: new Date(event.syncedAt),
        },
        create: {
          userId,
          provider,
          messageSeq: event.messageSeq,
          title: event.title,
          senderId: event.senderId ?? null,
          senderName: event.senderName ?? null,
          bodyText: event.bodyText,
          sentAt: toDate(event.sentAt ?? null),
          isRead: event.isRead,
          syncedAt: new Date(event.syncedAt),
        },
      }),
    );

    if (isNewRecord) {
      newMessageCount += 1;
      newMessages.push({
        messageSeq: event.messageSeq,
        title: event.title,
        senderName: event.senderName ?? null,
        sentAt: event.sentAt ?? null,
      });
    }

    existingMessageSet.add(event.messageSeq);
    existingMessageBySeq.set(event.messageSeq, nextIsRead);
  }

  for (const task of data.tasks) {
    const availableFrom = toDate(task.availableFrom ?? null);
    const dueAt = toDate(task.dueAt ?? null);
    const taskUpdate: {
      weekNo: number;
      lessonNo: number;
      activityType: "VOD" | "MATERIAL" | "QUIZ" | "ASSIGNMENT" | "ETC";
      requiredSeconds: number;
      learnedSeconds: number;
      state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
      availableFrom?: Date | null;
      dueAt?: Date | null;
    } = {
      weekNo: task.weekNo,
      lessonNo: task.lessonNo,
      activityType: task.activityType,
      requiredSeconds: task.requiredSeconds,
      learnedSeconds: task.learnedSeconds,
      state: task.state,
    };

    if (task.availableFrom && availableFrom) {
      taskUpdate.availableFrom = availableFrom;
    }
    if (task.dueAt && dueAt) {
      taskUpdate.dueAt = dueAt;
    }

    await runWithPrismaRetry(() =>
      prisma.learningTask.upsert({
        where: {
          userId_provider_lectureSeq_courseContentsSeq: {
            userId,
            provider,
            lectureSeq: task.lectureSeq,
            courseContentsSeq: task.courseContentsSeq,
          },
        },
        update: {
          provider,
          ...taskUpdate,
        },
        create: {
          userId,
          provider,
          lectureSeq: task.lectureSeq,
          courseContentsSeq: task.courseContentsSeq,
          weekNo: task.weekNo,
          lessonNo: task.lessonNo,
          activityType: task.activityType,
          requiredSeconds: task.requiredSeconds,
          learnedSeconds: task.learnedSeconds,
          state: task.state,
          availableFrom,
          dueAt,
        },
      }),
    );
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  type ParsedDeadlineTask = {
    lectureSeq: number;
    courseContentsSeq: number;
    weekNo: number;
    lessonNo: number;
    dueAt: string;
    dueAtMs: number;
  };

  const deadlineTasks = data.tasks
    .map((task): ParsedDeadlineTask | null => {
      if (task.state !== "PENDING" || typeof task.dueAt !== "string") return null;
      const dueAt = new Date(task.dueAt);
      const dueAtMs = dueAt.getTime();
      if (!Number.isFinite(dueAtMs)) return null;

      return {
        lectureSeq: task.lectureSeq,
        courseContentsSeq: task.courseContentsSeq,
        weekNo: task.weekNo,
        lessonNo: task.lessonNo,
        dueAt: task.dueAt,
        dueAtMs,
      };
    })
    .filter((task): task is ParsedDeadlineTask => task !== null)
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
  const unreadMessageCount = await prisma.portalMessage.count({
    where: {
      userId,
      provider,
      isRead: false,
    },
  });

  return {
    newNoticeCount,
    newNotificationCount,
    newUnreadNotificationCount,
    newMessageCount,
    unreadMessageCount,
    newNotices,
    newUnreadNotifications,
    newMessages,
    deadlineTasks,
    pendingTaskCount,
  };
}

export async function recordLearningRun(
  userId: string,
  provider: PortalProvider,
  lectureSeq: number | null,
  status: "SUCCESS" | "FAILED",
  message?: string,
) {
  await prisma.learningRun.create({
    data: {
      userId,
      provider,
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
  provider: PortalProvider,
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
        provider,
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

