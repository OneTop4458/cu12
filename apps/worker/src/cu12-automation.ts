import {
  parseMyCourseHtml,
  parseNoticeListHtml,
  parseNotificationListHtml,
  parseTodoVodTasks,
  type CourseNotice,
  type CourseState,
  type LearningTask,
  type NotificationEvent,
} from "@cu12/core";
import type { Browser, Page } from "playwright";
import { getEnv } from "./env";

export interface Cu12Credentials {
  cu12Id: string;
  cu12Password: string;
  campus: "SONGSIM" | "SONGSIN";
}

export interface SyncSnapshotResult {
  courses: CourseState[];
  notices: CourseNotice[];
  notifications: NotificationEvent[];
  tasks: LearningTask[];
}

export interface AutoLearnResult {
  watchedTaskCount: number;
  watchedSeconds: number;
  lectureSeqs: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installDialogHandler(page: Page) {
  page.on("dialog", async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // Ignore dialog handling failures
    }
  });
}

async function ensureLogin(page: Page, creds: Cu12Credentials) {
  const env = getEnv();
  await page.goto(`${env.CU12_BASE_URL}/el/member/login_form.acl`, { waitUntil: "domcontentloaded" });

  const catholicUniversityButton = page.getByRole("button", { name: "가톨릭대학교", exact: true });
  if (await catholicUniversityButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await catholicUniversityButton.click();
  }

  if (creds.campus === "SONGSIN") {
    const songsinRadio = page.getByRole("radio", { name: "성신교정" });
    if (await songsinRadio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await songsinRadio.check();
    }
  }

  await page.getByRole("textbox", { name: "아이디" }).fill(creds.cu12Id);
  await page.getByRole("textbox", { name: "비밀번호" }).fill(creds.cu12Password);
  await page.getByRole("button", { name: "로그인" }).click();

  await page.waitForURL(/\/el\/(main\/main_form|member\/mycourse_list_form)\.acl/, {
    timeout: 20000,
  });
}

async function fetchNotificationHtml(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/el/co/notification_list.acl", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "encoding=utf-8",
    });
    return response.text();
  });
}

export async function collectCu12Snapshot(browser: Browser, userId: string, creds: Cu12Credentials): Promise<SyncSnapshotResult> {
  const env = getEnv();
  const context = await browser.newContext();
  const page = await context.newPage();
  installDialogHandler(page);

  try {
    await ensureLogin(page, creds);

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const myCourseHtml = await page.content();
    const courses = parseMyCourseHtml(myCourseHtml, userId, "ACTIVE");

    const notices: CourseNotice[] = [];
    const tasks: LearningTask[] = [];

    for (const course of courses) {
      await page.goto(`${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      notices.push(...parseNoticeListHtml(await page.content(), userId, course.lectureSeq));

      await page.goto(`${env.CU12_BASE_URL}/el/class/todo_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      tasks.push(...parseTodoVodTasks(await page.content(), userId, course.lectureSeq));
    }

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const notificationHtml = await fetchNotificationHtml(page);
    const notifications = parseNotificationListHtml(notificationHtml, userId);

    return { courses, notices, notifications, tasks };
  } finally {
    await context.close();
  }
}

async function watchVodTask(page: Page, lectureSeq: number, task: LearningTask): Promise<number> {
  const env = getEnv();
  const remainingSeconds = Math.max(0, task.requiredSeconds - task.learnedSeconds);
  if (remainingSeconds <= 0) {
    return 0;
  }

  const waitSeconds = Math.ceil(remainingSeconds * env.AUTOLEARN_TIME_FACTOR);
  const targetUrl = `${env.CU12_BASE_URL}/el/class/contents_vod_view_form.acl?LECTURE_SEQ=${lectureSeq}&COURSE_CONTENTS_SEQ=${task.courseContentsSeq}&WEEK_NO=${task.weekNo}&LESSNS_NO=${task.lessonNo}`;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // The service records attendance by periodic heartbeats during playback;
  // we keep the page open for the remaining required time.
  await sleep(waitSeconds * 1000);

  await page.evaluate(() => {
    const fn = (window as unknown as { pageExit?: (isExit?: boolean) => void }).pageExit;
    if (typeof fn === "function") {
      fn(false);
    }
  });

  await page.waitForTimeout(2000);
  return waitSeconds;
}

export async function runAutoLearning(
  browser: Browser,
  userId: string,
  creds: Cu12Credentials,
  targetLectureSeq?: number,
): Promise<AutoLearnResult> {
  const env = getEnv();
  const context = await browser.newContext();
  const page = await context.newPage();
  installDialogHandler(page);

  try {
    await ensureLogin(page, creds);

    const lectureSeqs = new Set<number>();

    if (targetLectureSeq) {
      lectureSeqs.add(targetLectureSeq);
    } else {
      await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
      const courses = parseMyCourseHtml(await page.content(), userId, "ACTIVE");
      for (const course of courses) {
        lectureSeqs.add(course.lectureSeq);
      }
    }

    let watchedTaskCount = 0;
    let watchedSeconds = 0;

    for (const lectureSeq of lectureSeqs) {
      await page.goto(`${env.CU12_BASE_URL}/el/class/todo_list_form.acl?LECTURE_SEQ=${lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      const tasks = parseTodoVodTasks(await page.content(), userId, lectureSeq)
        .filter((task) => task.state === "PENDING")
        .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));

      for (const task of tasks) {
        if (watchedTaskCount >= env.AUTOLEARN_MAX_TASKS) {
          break;
        }

        const watched = await watchVodTask(page, lectureSeq, task);
        if (watched > 0) {
          watchedTaskCount += 1;
          watchedSeconds += watched;
        }
      }

      if (watchedTaskCount >= env.AUTOLEARN_MAX_TASKS) {
        break;
      }
    }

    return {
      watchedTaskCount,
      watchedSeconds,
      lectureSeqs: Array.from(lectureSeqs),
    };
  } finally {
    await context.close();
  }
}
