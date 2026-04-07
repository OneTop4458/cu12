import {
  parseCyberCampusCommunityNoticeListHtml,
  parseCyberCampusMainCoursesHtml,
  parseCyberCampusMessageDetailHtml,
  parseCyberCampusMessageListHtml,
  parseCyberCampusNotificationListHtml,
  parseCyberCampusTodoListHtml,
  type PortalMessage,
} from "@cu12/core";
import { type Browser, type BrowserContextOptions, type Page } from "playwright";
import type {
  AutoLearnMode,
  AutoLearnPlannedTask,
  AutoLearnProgress,
  AutoLearnResult,
  SyncProgress,
  SyncSnapshotResult,
} from "./cu12-automation";
import { getEnv } from "./env";

export interface CyberCampusCredentials {
  cu12Id: string;
  cu12Password: string;
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

function mergeCourses(
  base: ReturnType<typeof parseCyberCampusMainCoursesHtml>,
  notifications: ReturnType<typeof parseCyberCampusNotificationListHtml>,
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

  for (const event of notifications) {
    const rawCourseKey = event.notifierSeq.match(/^\d+$/) ? "" : "";
    const lectureSeq = 0;
    if (lectureSeq <= 0 || seen.has(lectureSeq)) continue;
    seen.set(lectureSeq, {
      userId,
      lectureSeq,
      externalLectureId: rawCourseKey || null,
      title: event.courseTitle,
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
): Promise<CyberCampusSnapshotResult> {
  const context = await browser.newContext(createBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  const reportProgress = async (progress: SyncProgress) => {
    if (!onProgress) return;
    await onProgress(progress);
  };

  try {
    await loginCyberCampus(page, creds);
    if (await shouldCancel()) throw new Error("JOB_CANCELLED");

    const mainHtml = await page.content();
    const notificationHtml = await fetchText(
      page,
      "/ilos/mp/notification_list.acl",
      { method: "POST", body: "start=1&display=100&OPEN_DTM=&encoding=utf-8" },
    );
    const todoHtml = await fetchText(
      page,
      "/ilos/mp/todo_list.acl",
      { method: "POST", body: "todoKjList=&chk_cate=ALL&encoding=utf-8" },
    );
    const baseCourses = parseCyberCampusMainCoursesHtml(mainHtml, userId, "ACTIVE");
    const notices = parseCyberCampusCommunityNoticeListHtml(mainHtml, userId);
    const notifications = parseCyberCampusNotificationListHtml(notificationHtml, userId);
    const tasks = parseCyberCampusTodoListHtml(todoHtml, userId);
    const courses = mergeCourses(baseCourses, notifications, tasks, userId);
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
    await loginCyberCampus(page, creds);
    const todoHtml = await fetchText(
      page,
      "/ilos/mp/todo_list.acl",
      { method: "POST", body: "todoKjList=&chk_cate=ALL&encoding=utf-8" },
    );
    const tasks = parseCyberCampusTodoListHtml(todoHtml, userId)
      .filter((task) => task.activityType === "VOD");

    const plannedBase = options.mode === "ALL_COURSES"
      ? tasks
      : tasks.filter((task) => task.lectureSeq === options.lectureSeq);
    const plannedTask = plannedBase[0] ?? null;

    const planned: AutoLearnPlannedTask[] = plannedTask
      ? [{
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
        remainingSeconds: 0,
      }]
      : [];

    if (onProgress) {
      await onProgress({
        phase: "PLANNING",
        mode: options.mode,
        totalTasks: planned.length,
        completedTasks: 0,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: 0,
        noOpReason: planned.length === 0 ? "NO_PENDING_SUPPORTED_TASKS" : null,
        plannedTaskCount: planned.length,
        planned,
        truncated: false,
        heartbeatAt: new Date().toISOString(),
      });
    }

    if (!plannedTask) {
      return {
        mode: options.mode,
        lectureSeqs: [],
        processedTaskCount: 0,
        elapsedSeconds: 0,
        plannedTaskCount: 0,
        truncated: false,
        estimatedTotalSeconds: 0,
        noOpReason: "NO_PENDING_SUPPORTED_TASKS",
        planned,
      };
    }

    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const rawLectureId = plannedTask.externalLectureId;
    if (!rawLectureId) {
      throw new Error("CYBER_CAMPUS_LECTURE_ID_MISSING");
    }

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

    return {
      mode: options.mode,
      lectureSeqs: [plannedTask.lectureSeq],
      processedTaskCount: 1,
      elapsedSeconds: 0,
      plannedTaskCount: 1,
      truncated: false,
      estimatedTotalSeconds: 0,
      planned,
    };
  } finally {
    await context.close();
  }
}
