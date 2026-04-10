import {
  parseCyberCampusCommunityNoticeDetailHtml,
  parseCyberCampusCommunityNoticeListHtml,
  parseCyberCampusCourseNoticeDetailHtml,
  parseCyberCampusCourseNoticeListHtml,
  parseCyberCampusCourseSubmainHtml,
  parseCyberCampusExamDetailHtml,
  parseCyberCampusMainCoursesHtml,
  parseCyberCampusMessageDetailHtml,
  parseCyberCampusMessageListHtml,
  parseCyberCampusNotificationListHtml,
  parseCyberCampusOnlineWeekDetailHtml,
  parseCyberCampusPlanHtml,
  parseCyberCampusTodoListHtml,
  type CourseNotice,
  type CourseState,
  type LearningTask,
  type PortalMessage,
} from "@cu12/core";
import { type Browser, type BrowserContextOptions, type Page } from "playwright";
import type {
  AutoLearnMode,
  AutoLearnNoOpReason,
  AutoLearnPlannedTask,
  AutoLearnProgress,
  AutoLearnResult,
  SyncProgress,
  SyncSnapshotResult,
} from "./cu12-automation";
import { retryOnceAfterEmptyStoredSession } from "./cyber-campus-session-recovery";
import { getEnv } from "./env";

export interface CyberCampusCredentials {
  cu12Id: string;
  cu12Password: string;
}

export interface CyberCampusCookieStateEntry {
  name: string;
  value: string;
}

export interface CyberCampusSnapshotResult extends SyncSnapshotResult {
  messages: PortalMessage[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/124.0.0.0 Safari/537.36";

type CancelCheck = () => Promise<boolean>;

function createBrowserContextOptions(): BrowserContextOptions {
  const env = getEnv();
  return {
    userAgent: env.PLAYWRIGHT_USER_AGENT ?? DEFAULT_USER_AGENT,
    locale: env.PLAYWRIGHT_LOCALE,
    timezoneId: env.PLAYWRIGHT_TIMEZONE,
    extraHTTPHeaders: {
      "accept-language": env.PLAYWRIGHT_ACCEPT_LANGUAGE,
    },
    viewport: {
      width: env.PLAYWRIGHT_VIEWPORT_WIDTH,
      height: env.PLAYWRIGHT_VIEWPORT_HEIGHT,
    },
  };
}

async function loginCyberCampus(page: Page, creds: CyberCampusCredentials): Promise<void> {
  await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/member/login_form.acl`, { waitUntil: "domcontentloaded" });
  await page.fill("#usr_id", creds.cu12Id);
  await page.fill("#usr_pwd", creds.cu12Password);
  await page.click("#login_btn");
  await page.waitForURL(/\/ilos\/main\/main_form\.acl/, { timeout: 20000 });
}

async function forceFreshCyberCampusLogin(page: Page, creds: CyberCampusCredentials): Promise<void> {
  await page.context().clearCookies();
  await loginCyberCampus(page, creds);
}

function looksAuthenticated(html: string, responseUrl: string): boolean {
  if (/\/ilos\/main\/main_form\.acl/i.test(responseUrl)) return true;
  return /\/ilos\/lo\/logout\.acl/i.test(html)
    || /popTodo\(/i.test(html)
    || /received_list_pop_form\.acl/i.test(html);
}

async function applyCookieStateToContext(
  page: Page,
  cookieState?: CyberCampusCookieStateEntry[],
): Promise<void> {
  if (!cookieState?.length) return;
  await page.context().addCookies(
    cookieState.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: getEnv().CYBER_CAMPUS_BASE_URL,
    })),
  );
}

async function ensureCyberCampusSession(
  page: Page,
  creds: CyberCampusCredentials | null,
  options?: {
    cookieState?: CyberCampusCookieStateEntry[];
    requireVerifiedSession?: boolean;
  },
): Promise<void> {
  await applyCookieStateToContext(page, options?.cookieState);
  if (options?.cookieState?.length) {
    await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/main_form.acl`, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    if (looksAuthenticated(html, page.url())) {
      return;
    }
    if (options.requireVerifiedSession) {
      throw new Error("CYBER_CAMPUS_SESSION_INVALID");
    }
  }

  if (!creds) {
    throw new Error("CYBER_CAMPUS_SESSION_INVALID");
  }

  await loginCyberCampus(page, creds);
}

async function fetchText(
  page: Page,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: string;
  },
): Promise<string> {
  const method = options?.method ?? "GET";
  const body = options?.body ?? "";
  const url = new URL(path, getEnv().CYBER_CAMPUS_BASE_URL).toString();
  return page.evaluate(
    async ({ inputUrl, inputMethod, inputBody }) => {
      const response = await fetch(inputUrl, {
        method: inputMethod,
        headers: inputMethod === "POST"
          ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
          : undefined,
        body: inputMethod === "POST" ? inputBody : undefined,
        credentials: "include",
      });
      return await response.text();
    },
    { inputUrl: url, inputMethod: method, inputBody: body },
  );
}

async function fetchJson<T>(
  page: Page,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: string;
  },
): Promise<T> {
  return JSON.parse(await fetchText(page, path, options)) as T;
}

interface CyberCampusTaskPlanningState {
  mainHtml: string;
  baseCourses: ReturnType<typeof parseCyberCampusMainCoursesHtml>;
  baseTasks: ReturnType<typeof parseCyberCampusTodoListHtml>;
}

async function loadCyberCampusTaskPlanningState(
  page: Page,
  userId: string,
): Promise<CyberCampusTaskPlanningState> {
  const mainHtml = await page.content();
  const todoHtml = await fetchText(
    page,
    "/ilos/mp/todo_list.acl",
    { method: "POST", body: "todoKjList=&chk_cate=ALL&encoding=utf-8" },
  );

  return {
    mainHtml,
    baseCourses: parseCyberCampusMainCoursesHtml(mainHtml, userId, "ACTIVE"),
    baseTasks: parseCyberCampusTodoListHtml(todoHtml, userId),
  };
}

interface CyberCampusCourseRoomResponse {
  isError?: boolean;
  message?: string;
  returnURL?: string;
}

function buildCyberCampusTaskKey(task: Pick<LearningTask, "externalLectureId" | "courseContentsSeq">): string | null {
  const externalLectureId = task.externalLectureId?.trim() ?? "";
  if (!externalLectureId || !Number.isFinite(task.courseContentsSeq) || task.courseContentsSeq <= 0) {
    return null;
  }

  return `${externalLectureId}:${task.courseContentsSeq}`;
}

export function mergeCyberCampusTaskWithDetail(
  baseTask: LearningTask,
  detailTask?: LearningTask | null,
): LearningTask {
  if (!detailTask) {
    return baseTask;
  }

  return {
    ...baseTask,
    weekNo: detailTask.weekNo > 0 ? detailTask.weekNo : baseTask.weekNo,
    lessonNo: detailTask.lessonNo > 0 ? detailTask.lessonNo : baseTask.lessonNo,
    taskTitle: detailTask.taskTitle?.trim() ? detailTask.taskTitle : baseTask.taskTitle,
    activityType: detailTask.activityType,
    requiredSeconds: detailTask.requiredSeconds,
    learnedSeconds: detailTask.learnedSeconds,
    state: detailTask.state,
    availableFrom: detailTask.availableFrom ?? baseTask.availableFrom,
    dueAt: detailTask.dueAt ?? baseTask.dueAt,
  };
}

function mergeCyberCampusNoticeWithDetail(
  notice: CourseNotice,
  detail: Partial<Pick<CourseNotice, "title" | "author" | "postedAt" | "bodyText">> | null,
): CourseNotice {
  if (!detail) {
    return notice;
  }

  return {
    ...notice,
    title: detail.title?.trim().length ? detail.title : notice.title,
    author: detail.author ?? notice.author,
    postedAt: detail.postedAt ?? notice.postedAt,
    bodyText: detail.bodyText?.trim().length ? detail.bodyText : notice.bodyText,
  };
}

function mergeCyberCampusCourseMetadata(
  courses: CourseState[],
  progressPercentByLectureSeq: Map<number, number>,
  instructorByLectureSeq: Map<number, string | null>,
): CourseState[] {
  return courses.map((course) => {
    const progressPercent = progressPercentByLectureSeq.get(course.lectureSeq);
    return {
      ...course,
      progressPercent: progressPercent ?? course.progressPercent,
      instructor: instructorByLectureSeq.get(course.lectureSeq) ?? course.instructor,
    };
  });
}

function mergeCourses(
  base: ReturnType<typeof parseCyberCampusMainCoursesHtml>,
  tasks: ReturnType<typeof parseCyberCampusTodoListHtml>,
  userId: string,
) {
  const seen = new Map<number, (typeof base)[number]>();
  for (const course of base) {
    seen.set(course.lectureSeq, course);
  }

  for (const task of tasks) {
    if (seen.has(task.lectureSeq)) continue;
    seen.set(task.lectureSeq, {
      userId,
      lectureSeq: task.lectureSeq,
      externalLectureId: task.externalLectureId ?? null,
      title: task.taskTitle ?? `Course ${task.lectureSeq}`,
      instructor: null,
      progressPercent: 0,
      remainDays: null,
      recentLearnedAt: null,
      periodStart: null,
      periodEnd: null,
      status: "ACTIVE",
      syncedAt: new Date().toISOString(),
    });
  }

  return [...seen.values()];
}

async function waitForCyberCampusOnlineWeekDetail(page: Page): Promise<void> {
  await page.waitForURL(/\/ilos\/st\/course\/online_list_form\.acl/i, { timeout: 10000 }).catch(() => {});
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("[id^='lecture-']").length > 0,
      undefined,
      { timeout: 10000 },
    );
  } catch {
    await page.waitForTimeout(1500);
  }
}

async function waitForCyberCampusExamDetail(page: Page): Promise<void> {
  await page.waitForURL(/\/ilos\/st\/course\/test_view_form\.acl/i, { timeout: 10000 }).catch(() => {});
  try {
    await page.waitForSelector("table.bbsview, table", { timeout: 10000 });
  } catch {
    await page.waitForTimeout(1000);
  }
}

async function openCyberCampusCourseSubmain(page: Page, externalLectureId: string): Promise<void> {
  const response = await fetchJson<CyberCampusCourseRoomResponse>(
    page,
    "/ilos/st/course/eclass_room2.acl",
    {
      method: "POST",
      body: new URLSearchParams({
        KJKEY: externalLectureId,
        returnData: "json",
        returnURI: "/ilos/st/course/submain_form.acl",
        encoding: "utf-8",
      }).toString(),
    },
  );
  if (response.isError || !response.returnURL) {
    throw new Error(response.message || "CYBER_CAMPUS_SUBMAIN_OPEN_FAILED");
  }

  await page.goto(
    new URL(response.returnURL, getEnv().CYBER_CAMPUS_BASE_URL).toString(),
    { waitUntil: "domcontentloaded" },
  );
}

function mergeCyberCampusTaskCollections(baseTasks: LearningTask[], detailTasks: LearningTask[]): LearningTask[] {
  const mergedByKey = new Map<string, LearningTask>();
  const passthroughTasks: LearningTask[] = [];

  for (const task of baseTasks) {
    const taskKey = buildCyberCampusTaskKey(task);
    if (!taskKey) {
      passthroughTasks.push(task);
      continue;
    }
    mergedByKey.set(taskKey, task);
  }

  for (const task of detailTasks) {
    const taskKey = buildCyberCampusTaskKey(task);
    if (!taskKey) {
      passthroughTasks.push(task);
      continue;
    }
    mergedByKey.set(taskKey, mergeCyberCampusTaskWithDetail(mergedByKey.get(taskKey) ?? task, task));
  }

  return [
    ...mergedByKey.values(),
    ...passthroughTasks.filter((task) => {
      const taskKey = buildCyberCampusTaskKey(task);
      return !taskKey || !mergedByKey.has(taskKey);
    }),
  ];
}

async function enrichCyberCampusTasks(
  contextPage: Page,
  userId: string,
  courses: CourseState[],
  baseTasks: LearningTask[],
  options?: {
    activityTypes?: Array<LearningTask["activityType"]>;
    onCancelCheck?: CancelCheck;
    collectCourseMetadata?: boolean;
  },
): Promise<{
  tasks: LearningTask[];
  progressPercentByLectureSeq: Map<number, number>;
  instructorByLectureSeq: Map<number, string | null>;
  courseNotices: CourseNotice[];
}> {
  const selectedTypes = new Set(options?.activityTypes ?? ["VOD"]);
  const shouldCancel = options?.onCancelCheck ?? (async () => false);
  const progressPercentByLectureSeq = new Map<number, number>();
  const instructorByLectureSeq = new Map<number, string | null>();
  const courseNotices: CourseNotice[] = [];
  const detailTasks: LearningTask[] = [];
  const detailPage = await contextPage.context().newPage();

  try {
    await detailPage.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/main_form.acl`, { waitUntil: "domcontentloaded" });

    for (const course of courses) {
      if (await shouldCancel()) throw new Error("JOB_CANCELLED");
      const externalLectureId = course.externalLectureId?.trim();
      if (!externalLectureId) continue;

      try {
        await openCyberCampusCourseSubmain(detailPage, externalLectureId);
        const submain = parseCyberCampusCourseSubmainHtml(await detailPage.content());
        progressPercentByLectureSeq.set(course.lectureSeq, submain.progressPercent);

        if (options?.collectCourseMetadata) {
          try {
            await detailPage.goto(
              `${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/st/course/plan_form.acl`,
              { waitUntil: "domcontentloaded" },
            );
            instructorByLectureSeq.set(course.lectureSeq, parseCyberCampusPlanHtml(await detailPage.content()).instructor);
          } catch {
            instructorByLectureSeq.set(course.lectureSeq, course.instructor);
          }

          try {
            await detailPage.goto(
              `${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/st/course/notice_list_form.acl`,
              { waitUntil: "domcontentloaded" },
            );
            const notices = parseCyberCampusCourseNoticeListHtml(
              await detailPage.content(),
              userId,
              course.lectureSeq,
              externalLectureId,
            );
            courseNotices.push(...await enrichCyberCampusCourseNotices(detailPage, notices, shouldCancel));
          } catch {
            // Keep sync running even when a course notice page cannot be resolved.
          }
        }

        if (selectedTypes.has("VOD")) {
          for (const weekNo of submain.onlineWeekNumbers) {
            if (await shouldCancel()) throw new Error("JOB_CANCELLED");
            await detailPage.goto(
              `${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/st/course/online_list_form.acl?WEEK_NO=${weekNo}`,
              { waitUntil: "domcontentloaded" },
            );
            await waitForCyberCampusOnlineWeekDetail(detailPage);
            const detail = parseCyberCampusOnlineWeekDetailHtml(await detailPage.content(), userId, externalLectureId);
            detailTasks.push(...detail.tasks);
          }
        }

        if (selectedTypes.has("QUIZ")) {
          for (const quizRef of submain.quizRefs) {
            if (await shouldCancel()) throw new Error("JOB_CANCELLED");
          await detailPage.goto(
              new URL(quizRef.href, getEnv().CYBER_CAMPUS_BASE_URL).toString(),
            { waitUntil: "domcontentloaded" },
          );
          await waitForCyberCampusExamDetail(detailPage);
          const detailTask = parseCyberCampusExamDetailHtml(
            await detailPage.content(),
            userId,
            externalLectureId,
              quizRef.examSetupSeq,
          );
          if (detailTask) {
              detailTasks.push({
                ...detailTask,
                weekNo: detailTask.weekNo > 0 ? detailTask.weekNo : quizRef.weekNo,
                taskTitle: detailTask.taskTitle || quizRef.title,
              });
            }
          }
        }
      } catch {
        for (const task of baseTasks) {
          if (task.externalLectureId !== externalLectureId) continue;
          if (!selectedTypes.has(task.activityType)) continue;
          detailTasks.push(task);
        }
      }
    }

    return {
      tasks: [
        ...mergeCyberCampusTaskCollections(
          baseTasks.filter((task) => selectedTypes.has(task.activityType)),
          detailTasks.filter((task) => selectedTypes.has(task.activityType)),
        ),
        ...baseTasks.filter((task) => !selectedTypes.has(task.activityType)),
      ],
      progressPercentByLectureSeq,
      instructorByLectureSeq,
      courseNotices,
    };
  } finally {
    await detailPage.close();
  }
}

async function enrichCyberCampusCommunityNotices(
  page: Page,
  notices: CourseNotice[],
  onCancelCheck?: CancelCheck,
): Promise<CourseNotice[]> {
  const shouldCancel = onCancelCheck ?? (async () => false);
  const detailByNoticeSeq = new Map<string, Pick<CourseNotice, "author" | "postedAt" | "bodyText"> | null>();
  const merged: CourseNotice[] = [];

  for (const notice of notices) {
    if (await shouldCancel()) throw new Error("JOB_CANCELLED");

    const noticeSeq = notice.noticeSeq?.trim();
    if (!noticeSeq) {
      merged.push(notice);
      continue;
    }

    if (!detailByNoticeSeq.has(noticeSeq)) {
      try {
        const detailHtml = await fetchText(
          page,
          `/ilos/community/notice_view_form.acl?ARTL_NUM=${encodeURIComponent(noticeSeq)}`,
        );
        detailByNoticeSeq.set(noticeSeq, parseCyberCampusCommunityNoticeDetailHtml(detailHtml));
      } catch {
        detailByNoticeSeq.set(noticeSeq, null);
      }
    }

    merged.push(mergeCyberCampusNoticeWithDetail(notice, detailByNoticeSeq.get(noticeSeq) ?? null));
  }

  return merged;
}

async function enrichCyberCampusCourseNotices(
  page: Page,
  notices: CourseNotice[],
  onCancelCheck?: CancelCheck,
): Promise<CourseNotice[]> {
  const shouldCancel = onCancelCheck ?? (async () => false);
  const detailByNoticeSeq = new Map<string, Pick<CourseNotice, "title" | "author" | "postedAt" | "bodyText"> | null>();
  const merged: CourseNotice[] = [];

  for (const notice of notices) {
    if (await shouldCancel()) throw new Error("JOB_CANCELLED");

    const noticeSeq = notice.noticeSeq?.trim();
    if (!noticeSeq) {
      merged.push(notice);
      continue;
    }

    if (!detailByNoticeSeq.has(noticeSeq)) {
      try {
        await page.goto(
          `${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/st/course/notice_view_form.acl?ARTL_NUM=${encodeURIComponent(noticeSeq)}`,
          { waitUntil: "domcontentloaded" },
        );
        detailByNoticeSeq.set(noticeSeq, parseCyberCampusCourseNoticeDetailHtml(await page.content()));
      } catch {
        detailByNoticeSeq.set(noticeSeq, null);
      }
    }

    merged.push(mergeCyberCampusNoticeWithDetail(notice, detailByNoticeSeq.get(noticeSeq) ?? null));
  }

  return merged;
}

function sortCyberCampusTasks<T extends { weekNo: number; lessonNo: number }>(tasks: T[]): T[] {
  return tasks
    .slice()
    .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));
}

function parseDateMsOrNull(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinCyberCampusLearningWindow(task: LearningTask, nowMs: number): boolean {
  const availableFromMs = parseDateMsOrNull(task.availableFrom);
  if (availableFromMs !== null && nowMs < availableFromMs) return false;

  const dueAtMs = parseDateMsOrNull(task.dueAt);
  if (dueAtMs !== null && nowMs > dueAtMs) return false;

  return true;
}

function toAutoLearnPlannedTask(plannedTask: LearningTask): AutoLearnPlannedTask {
  return {
    lectureSeq: plannedTask.lectureSeq,
    courseContentsSeq: plannedTask.courseContentsSeq,
    courseTitle: plannedTask.taskTitle ?? `Course ${plannedTask.lectureSeq}`,
    weekNo: plannedTask.weekNo,
    lessonNo: plannedTask.lessonNo,
    taskTitle: plannedTask.taskTitle ?? `Lesson ${plannedTask.lessonNo}`,
    state: plannedTask.state,
    activityType: plannedTask.activityType,
    requiredSeconds: plannedTask.requiredSeconds,
    learnedSeconds: plannedTask.learnedSeconds,
    availableFrom: plannedTask.availableFrom ?? null,
    dueAt: plannedTask.dueAt ?? null,
    remainingSeconds: Math.max(0, plannedTask.requiredSeconds - plannedTask.learnedSeconds),
  };
}

interface CyberCampusAutoLearnPlan {
  planned: AutoLearnPlannedTask[];
  noOpReason: AutoLearnNoOpReason | null;
  scopedPendingVodCount: number;
  scopedAvailableVodCount: number;
}

export function planCyberCampusAutoLearnTasks(
  tasks: LearningTask[],
  options: {
    mode: AutoLearnMode;
    lectureSeq?: number;
    nowMs?: number;
  },
): CyberCampusAutoLearnPlan {
  const nowMs = options.nowMs ?? Date.now();
  const matchesScope = (task: LearningTask) =>
    options.mode === "ALL_COURSES" || task.lectureSeq === options.lectureSeq;
  const scopedPendingVods = sortCyberCampusTasks(
    tasks.filter((task) => task.activityType === "VOD" && task.state === "PENDING" && matchesScope(task)),
  );
  const scopedAvailableVods = scopedPendingVods.filter((task) => isWithinCyberCampusLearningWindow(task, nowMs));
  const plannedBase = options.mode === "SINGLE_NEXT"
    ? scopedAvailableVods.slice(0, 1)
    : scopedAvailableVods;
  const planned = plannedBase.map(toAutoLearnPlannedTask);

  let noOpReason: AutoLearnNoOpReason | null = null;
  if (planned.length === 0) {
    if (scopedPendingVods.length === 0) {
      noOpReason = "NO_PENDING_VOD_TASKS";
    } else if (scopedAvailableVods.length === 0) {
      noOpReason = "NO_AVAILABLE_VOD_TASKS";
    } else {
      noOpReason = "NO_TASKS_AFTER_FILTER";
    }
  }

  return {
    planned,
    noOpReason,
    scopedPendingVodCount: scopedPendingVods.length,
    scopedAvailableVodCount: scopedAvailableVods.length,
  };
}

async function collectMessages(contextPage: Page, userId: string): Promise<PortalMessage[]> {
  const messagePage = await contextPage.context().newPage();
  try {
    await messagePage.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/message/received_list_pop_form.acl`, {
      waitUntil: "domcontentloaded",
    });
    await messagePage.waitForTimeout(1000);
    const listHtml = await messagePage.content();
    const list = parseCyberCampusMessageListHtml(listHtml, userId);
    const resolved: PortalMessage[] = [];

    for (const item of list.slice(0, 50)) {
      const detailHtml = await fetchText(
        messagePage,
        `/ilos/message/received_view_pop_form.acl?SEQ=${encodeURIComponent(item.messageSeq)}&SEND_ID=${encodeURIComponent(item.senderId ?? "")}`,
      );
      const detail = parseCyberCampusMessageDetailHtml(detailHtml);
      resolved.push({
        ...item,
        title: detail.title || item.title,
        senderName: detail.senderName ?? item.senderName ?? null,
        bodyText: detail.bodyText,
        sentAt: detail.sentAt,
      });
    }

    return resolved;
  } finally {
    await messagePage.close();
  }
}

export async function collectCyberCampusSnapshot(
  browser: Browser,
  userId: string,
  creds: CyberCampusCredentials,
  onCancelCheck?: CancelCheck,
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
  options?: {
    cookieState?: CyberCampusCookieStateEntry[];
  },
): Promise<CyberCampusSnapshotResult> {
  const context = await browser.newContext(createBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  const reportProgress = async (progress: SyncProgress) => {
    if (!onProgress) return;
    await onProgress(progress);
  };

  try {
    await ensureCyberCampusSession(page, creds, {
      cookieState: options?.cookieState,
      requireVerifiedSession: false,
    });
    if (await shouldCancel()) throw new Error("JOB_CANCELLED");
    const planningState = await retryOnceAfterEmptyStoredSession({
      hasStoredSession: Boolean(options?.cookieState?.length),
      load: () => loadCyberCampusTaskPlanningState(page, userId),
      isEmpty: (result) => result.baseTasks.length === 0,
      refresh: async () => {
        await forceFreshCyberCampusLogin(page, creds);
      },
    });
    if (planningState.retriedStoredSession && planningState.result.baseTasks.length > 0) {
      console.warn("[CYBER_CAMPUS] recovered empty snapshot task list after refreshing stored session");
    }

    const mainHtml = planningState.result.mainHtml;
    const notificationHtml = await fetchText(
      page,
      "/ilos/mp/notification_list.acl",
      { method: "POST", body: "start=1&display=100&OPEN_DTM=&encoding=utf-8" },
    );
    const baseCourses = planningState.result.baseCourses;
    const baseNotices = parseCyberCampusCommunityNoticeListHtml(mainHtml, userId);
    const notifications = parseCyberCampusNotificationListHtml(notificationHtml, userId);
    const baseTasks = planningState.result.baseTasks;
    const { tasks, progressPercentByLectureSeq, instructorByLectureSeq, courseNotices } = await enrichCyberCampusTasks(page, userId, baseCourses, baseTasks, {
      onCancelCheck: shouldCancel,
      collectCourseMetadata: true,
    });
    const communityNotices = await enrichCyberCampusCommunityNotices(page, baseNotices, shouldCancel);
    const notices = [...courseNotices, ...communityNotices];
    const courses = mergeCyberCampusCourseMetadata(
      mergeCourses(baseCourses, tasks, userId),
      progressPercentByLectureSeq,
      instructorByLectureSeq,
    );
    const messages = await collectMessages(page, userId);

    await reportProgress({
      phase: "DONE",
      totalCourses: courses.length,
      completedCourses: courses.length,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: notifications.length,
    });

    return {
      courses,
      notices,
      notifications,
      tasks,
      messages,
    };
  } finally {
    await context.close();
  }
}

export async function runCyberCampusAutoLearning(
  browser: Browser,
  userId: string,
  creds: CyberCampusCredentials,
  options: {
    mode: AutoLearnMode;
    lectureSeq?: number;
  },
  onProgress?: (progress: AutoLearnProgress) => Promise<void> | void,
  onCancelCheck?: CancelCheck,
  sessionOptions?: {
    cookieState?: CyberCampusCookieStateEntry[];
    requireVerifiedSession?: boolean;
  },
): Promise<AutoLearnResult> {
  const context = await browser.newContext(createBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  let secondaryAuthBlocked = false;

  page.on("dialog", async (dialog) => {
    if (dialog.message().includes("본인인증")) {
      secondaryAuthBlocked = true;
    }
    await dialog.accept();
  });

  try {
    await ensureCyberCampusSession(page, creds, sessionOptions);
    const planningState = await retryOnceAfterEmptyStoredSession({
      hasStoredSession: Boolean(sessionOptions?.cookieState?.length),
      load: () => loadCyberCampusTaskPlanningState(page, userId),
      isEmpty: (result) => result.baseTasks.length === 0,
      refresh: async () => {
        await forceFreshCyberCampusLogin(page, creds);
      },
    });
    if (planningState.retriedStoredSession && planningState.result.baseTasks.length > 0) {
      console.warn("[CYBER_CAMPUS] recovered empty autolearn task list after refreshing stored session");
    }

    const baseTasks = planningState.result.baseTasks;
    const baseCourses = planningState.result.baseCourses;
    const { tasks: enrichedTasks } = await enrichCyberCampusTasks(page, userId, baseCourses, baseTasks, {
      activityTypes: ["VOD"],
      onCancelCheck: shouldCancel,
    });
    const plan = planCyberCampusAutoLearnTasks(enrichedTasks, {
      mode: options.mode,
      lectureSeq: options.lectureSeq,
      nowMs: Date.now(),
    });
    const planned = plan.planned;

    if (onProgress) {
      await onProgress({
        phase: "PLANNING",
        mode: options.mode,
        totalTasks: planned.length,
        completedTasks: 0,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: 0,
        noOpReason: plan.noOpReason,
        plannedTaskCount: planned.length,
        planned,
        truncated: false,
        heartbeatAt: new Date().toISOString(),
      });
    }

    if (planned.length === 0) {
      return {
        mode: options.mode,
        lectureSeqs: [],
        processedTaskCount: 0,
        elapsedSeconds: 0,
        plannedTaskCount: 0,
        truncated: false,
        estimatedTotalSeconds: 0,
        noOpReason: plan.noOpReason,
        planned,
      };
    }

    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const lectureSeqs: number[] = [];
    const attemptedKeys: Array<{ lectureSeq: number; courseContentsSeq: number }> = [];

    for (const plannedTask of planned) {
      if (await shouldCancel()) {
        throw new Error("AUTOLEARN_CANCELLED");
      }

      const sourceTask = enrichedTasks.find(
        (task) =>
          task.lectureSeq === plannedTask.lectureSeq
          && task.courseContentsSeq === plannedTask.courseContentsSeq,
      );
      const rawLectureId = sourceTask?.externalLectureId;
      if (!rawLectureId) {
        throw new Error("CYBER_CAMPUS_LECTURE_ID_MISSING");
      }

      secondaryAuthBlocked = false;
      await page.goto(
        `${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/mp/todo_list_connect.acl?SEQ=${plannedTask.courseContentsSeq}&gubun=lecture_weeks&KJKEY=${encodeURIComponent(rawLectureId)}`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForTimeout(2000);
      await page.evaluate(
        ({ weekNo, lessonSeq }) => {
          const form = document.forms.namedItem("myform") as HTMLFormElement | null;
          if (!form) return;
          const lectureWeeks = form.querySelector<HTMLInputElement>('input[name="lecture_weeks"]');
          const weekNoInput = form.querySelector<HTMLInputElement>('input[name="WEEK_NO"]');
          const itemIdInput = form.querySelector<HTMLInputElement>('input[name="item_id"]');
          if (lectureWeeks) lectureWeeks.value = String(lessonSeq);
          if (weekNoInput) weekNoInput.value = String(weekNo);
          if (itemIdInput) itemIdInput.value = "";
          form.submit();
        },
        { weekNo: plannedTask.weekNo, lessonSeq: plannedTask.courseContentsSeq },
      );
      await page.waitForTimeout(3000);

      if (secondaryAuthBlocked || /\/ilos\/st\/course\/submain_form\.acl/i.test(page.url())) {
        throw new Error("CYBER_CAMPUS_SECONDARY_AUTH_REQUIRED");
      }

      attemptedKeys.push({
        lectureSeq: plannedTask.lectureSeq,
        courseContentsSeq: plannedTask.courseContentsSeq,
      });
      if (!lectureSeqs.includes(plannedTask.lectureSeq)) {
        lectureSeqs.push(plannedTask.lectureSeq);
      }

      if (onProgress) {
        await onProgress({
          phase: "RUNNING",
          mode: options.mode,
          totalTasks: planned.length,
          completedTasks: attemptedKeys.length,
          elapsedSeconds: 0,
          estimatedRemainingSeconds: 0,
          current: {
            lectureSeq: plannedTask.lectureSeq,
            weekNo: plannedTask.weekNo,
            lessonNo: plannedTask.lessonNo,
            activityType: plannedTask.activityType,
            remainingSeconds: plannedTask.remainingSeconds,
            courseTitle: plannedTask.courseTitle,
            taskTitle: plannedTask.taskTitle,
          },
          plannedTaskCount: planned.length,
          planned,
          truncated: false,
          heartbeatAt: new Date().toISOString(),
        });
      }
    }

    const refreshedTodoHtml = await fetchText(
      page,
      "/ilos/mp/todo_list.acl",
      { method: "POST", body: "todoKjList=&chk_cate=ALL&encoding=utf-8" },
    );
    const remainingTasks = parseCyberCampusTodoListHtml(refreshedTodoHtml, userId)
      .filter((task) => task.activityType === "VOD");
    const remainingKeys = new Set(
      remainingTasks.map((task) => `${task.lectureSeq}:${task.courseContentsSeq}`),
    );
    const confirmedCompleted = attemptedKeys.filter((task) => !remainingKeys.has(`${task.lectureSeq}:${task.courseContentsSeq}`));

    if (confirmedCompleted.length === 0) {
      throw new Error("CYBER_CAMPUS_LEARNING_NOT_CONFIRMED");
    }

    return {
      mode: options.mode,
      lectureSeqs,
      processedTaskCount: confirmedCompleted.length,
      elapsedSeconds: 0,
      plannedTaskCount: planned.length,
      truncated: false,
      estimatedTotalSeconds: 0,
      planned,
    };
  } finally {
    await context.close();
  }
}
