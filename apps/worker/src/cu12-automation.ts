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
import { type Browser, type BrowserContextOptions, type Page } from "playwright";
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

export type AutoLearnMode = "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";

interface PlannedTask {
  lectureSeq: number;
  task: LearningTask;
  remainingSeconds: number;
}

export interface AutoLearnProgress {
  phase: "PLANNING" | "RUNNING" | "DONE";
  mode: AutoLearnMode;
  totalTasks: number;
  completedTasks: number;
  watchedSeconds: number;
  estimatedRemainingSeconds: number;
  current?: {
    lectureSeq: number;
    weekNo: number;
    lessonNo: number;
    remainingSeconds: number;
  };
}

export interface AutoLearnResult {
  mode: AutoLearnMode;
  watchedTaskCount: number;
  watchedSeconds: number;
  lectureSeqs: number[];
  plannedTaskCount: number;
  truncated: boolean;
  estimatedTotalSeconds: number;
}

type CancelCheck = () => Promise<boolean>;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/124.0.0.0 Safari/537.36";

function createRealisticBrowserContextOptions(): BrowserContextOptions {
  const env = getEnv();
  return {
    userAgent: env.PLAYWRIGHT_USER_AGENT ?? DEFAULT_USER_AGENT,
    locale: env.PLAYWRIGHT_LOCALE,
    timezoneId: env.PLAYWRIGHT_TIMEZONE,
    viewport: {
      width: env.PLAYWRIGHT_VIEWPORT_WIDTH,
      height: env.PLAYWRIGHT_VIEWPORT_HEIGHT,
    },
  };
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

  const catholicUniversityButton = page.locator("#catholic");
  if (await catholicUniversityButton.count()) {
    await catholicUniversityButton.first().click();
  }

  const songsinRadio = page.locator('input[name="catholic_dv"][value="songsin"]');
  if (creds.campus === "SONGSIN" && (await songsinRadio.count())) {
    await songsinRadio.check();
  }

  const idInput = page.locator("#usr_id2, #usr_id").first();
  const pwInput = page.locator("#pwd2, #pwd").first();
  const loginButton = page.locator("#loginBtn_check2, #loginBtn_check1").first();

  await idInput.fill(creds.cu12Id);
  await pwInput.fill(creds.cu12Password);
  await loginButton.click();

  await page.waitForURL(/\/el\/(main\/main_form|member\/mycourse_list_form)\.acl/, {
    timeout: 20000,
  });
}

async function fetchNoticeBodies(page: Page, lectureSeq: number): Promise<Array<{ noticeSeq: string; bodyText: string }>> {
  return page.evaluate(async (seq) => {
    const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

    function stripMarkup(container: HTMLElement): string {
      container.querySelectorAll("script, style, link").forEach((node) => node.remove());
      return normalize(container.textContent ?? "");
    }

    function extractNoticeSeqFromNode(node: Element): string | null {
      const id = node.getAttribute("id")?.trim();
      const idMatch = id?.match(/notice_tit_(\d+)/)?.[1];
      if (idMatch) return idMatch;

      const onclick = node.getAttribute("onclick") ?? "";
      const onClickMatch =
        onclick.match(/noticeShow\([^,]+,\s*["']?(\d+)["']?\)/)?.[1]
        ?? onclick.match(/noticeShow\([^,]+,\s*(\d+)\s*\)/)?.[1]
        ?? onclick.match(/notiOpen\([^,]+,\s*["']?(\d+)["']?\)/)?.[1];
      if (onClickMatch) return onClickMatch;

      const dataNoticeSeq = node.getAttribute("data-notice-seq");
      if (dataNoticeSeq) return dataNoticeSeq;

      const anchor = node.getAttribute("href") ?? "";
      const hrefMatch =
        anchor.match(/noticeView\.acl[^?]*\?[^#]*notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/artl_seq=(\d+)/i)?.[1]
        ?? anchor.match(/notice_id=(\d+)/i)?.[1];
      if (hrefMatch) return hrefMatch;

      return null;
    }

    function collectNoticeSeqs(): string[] {
      const rawNodes = [
        ...Array.from(document.querySelectorAll("button.notice_title[id^='notice_tit_'], button.notice_title, a.notice_title")),
        ...Array.from(document.querySelectorAll("li, tr, div, dd, dl, article")).filter((item) => /傍瘤/.test(item.textContent ?? "")),
      ];

      const seqs = rawNodes
        .map((node) => extractNoticeSeqFromNode(node))
        .filter((seq): seq is string => Boolean(seq));

      return Array.from(new Set(seqs));
    }

    function extractNoticeNodeFromHtml(container: ParentNode, noticeSeq: string): HTMLElement | null {
      const selectors = [
        `#notice_${noticeSeq}`,
        `#notice_txt_${noticeSeq}`,
        `#notice-content-${noticeSeq}`,
        `#notice-content_${noticeSeq}`,
        `#notice_body_${noticeSeq}`,
        `.notice-content-${noticeSeq}`,
        `.notice-content_${noticeSeq}`,
        `.notice-body-${noticeSeq}`,
        `.notice_body_${noticeSeq}`,
        `.notice_${noticeSeq}`,
      ];

      for (const selector of selectors) {
        const node = container.querySelector(selector);
        if (node && normalize(node.textContent ?? "").length > 0) {
          return node as HTMLElement;
        }
      }

      return null;
    }

    function parseNoticeBodyFromHtml(rawHtml: string, noticeSeq: string): string {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = rawHtml;
      const candidates = [
        extractNoticeNodeFromHtml(wrapper, noticeSeq),
        wrapper.querySelector(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .cont, .txt"),
        wrapper.querySelector(`#content_${noticeSeq}`),
      ];

      const body = candidates
        .map((node) => stripMarkup((node as HTMLElement) ?? document.createElement("span")))
        .find((text) => text.length > 0);

      if (body) return body;

      const textMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rawHtml;
      return normalize((textMatch ?? "").replace(/<[^>]*>/g, ""));
    }

    function extractContentsSeq(html: string): string | null {
      const matches = [
        /CONTENTS_SEQ\s*[:=]\s*["']?(\d+)["']?/i,
        /contentSeq\s*[:=]\s*["']?(\d+)["']?/i,
        /course_contents_seq\s*[:=]\s*["']?(\d+)["']?/i,
      ];
      for (const match of matches) {
        const found = html.match(match);
        if (found?.[1]) return found[1];
      }
      return null;
    }

    function extractAttachments(rawHtml: string): Array<{ name: string; url: string }> {
      const doc = document.createElement("div");
      doc.innerHTML = rawHtml;
      const directLinks = Array.from(
        doc.querySelectorAll("a[href*='file_download'], a[data-href*='file_download'], a[href*='download'], a[data-href*='download']"),
      )
        .map((link) => {
          const href = (link.getAttribute("href") ?? link.getAttribute("data-href") ?? "").trim();
          const name = normalize(link.textContent ?? "");
          return href && name ? { name, url: href } : null;
        })
        .filter((item): item is { name: string; url: string } => Boolean(item));

      if (directLinks.length > 0) {
        return directLinks;
      }

      const fallbackRows = Array.from(doc.querySelectorAll("tr, li, .file-row, .item"))
        .map((row) => {
          const href =
            row.querySelector("a")?.getAttribute("href")?.trim()
            ?? row.querySelector("a")?.getAttribute("data-href")?.trim()
            ?? "";
          const name = normalize(row.textContent ?? "");
          return href && name ? { name, url: href } : null;
        })
        .filter((item): item is { name: string; url: string } => Boolean(item));

      return fallbackRows;
    }

    async function requestText(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<string> {
      try {
        const response = await fetch(url, init as RequestInit);
        if (!response.ok) return "";
        return response.text();
      } catch {
        return "";
      }
    }

    async function resolveNoticeContent(
      noticeSeq: string,
    ): Promise<{ bodyText: string; attachments: Array<{ name: string; url: string }> }> {
      const scriptText = Array.from(document.querySelectorAll("script"))
        .map((script) => script.textContent ?? "")
        .join("\n");

      const courseSeq =
        document.querySelector('input[name="COURSE_SEQ"]')?.getAttribute("value")
        ?? scriptText.match(/COURSE_SEQ\s*:\s*"(\d+)"/i)?.[1]
        ?? "";

      const queryString = new URLSearchParams({
        COURSE_SEQ: courseSeq,
        LECTURE_SEQ: String(seq),
        CUR_LECTURE_SEQ: String(seq),
        NOTICE_SEQ: noticeSeq,
        ARTL_SEQ: noticeSeq,
        CONTENTS_SEQ: noticeSeq,
        artl_seq: noticeSeq,
        notice_seq: noticeSeq,
        encoding: "utf-8",
      }).toString();

      const detailCandidates = [
        { method: "POST", url: "/el/class/notice_view.acl", body: queryString, contentType: true },
        { method: "POST", url: "/el/class/notice_list.acl", body: queryString, contentType: true },
        { method: "POST", url: "/el/class/notice_read.acl", body: queryString, contentType: true },
        { method: "GET", url: `/el/class/notice_view.acl?${queryString}` },
        { method: "GET", url: `/el/class/notice_list.acl?${queryString}` },
        { method: "GET", url: `/el/class/notice_read.acl?${queryString}` },
      ];

      const requestHtmls: string[] = [];
      const inlineNode = extractNoticeNodeFromHtml(document, noticeSeq);
      if (inlineNode) {
        const inlineText = stripMarkup(inlineNode as HTMLElement);
        if (inlineText) requestHtmls.push(`<div>${inlineText}</div>`);
      }

      for (const request of detailCandidates) {
        const text = await requestText(request.url, {
          method: request.method,
          headers: request.contentType
            ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" }
            : undefined,
          ...(request.method === "POST" ? { body: request.body } : {}),
        });
        if (text) requestHtmls.push(text);
      }

      for (const raw of requestHtmls) {
        const bodyText = parseNoticeBodyFromHtml(raw, noticeSeq);
        if (!bodyText) continue;

        const attachments = extractAttachments(raw);
        const contentsSeq = extractContentsSeq(raw);
        if (contentsSeq) {
          const fileListText = await requestText(
            `/el/co/file_list_user4.acl?CONTENTS_SEQ=${contentsSeq}&LECTURE_SEQ=${seq}&encoding=utf-8`,
          );
          const fileAttachments = extractAttachments(fileListText);
          const mergedAttachments = [...attachments, ...fileAttachments];
          if (mergedAttachments.length > 0) {
            return {
              bodyText: `${bodyText}\n\n[梅何颇老]\n${mergedAttachments.map((file) => `- ${file.name} (${file.url})`).join("\n")}`.trim(),
              attachments: mergedAttachments,
            };
          }
        }
        return { bodyText, attachments };
      }

      return { bodyText: "", attachments: [] };
    }

    const noticeSeqs = collectNoticeSeqs();
    const fallbackNoticeSeqs = Array.from(document.querySelectorAll<HTMLButtonElement>('button.notice_title'))
      .map((button) => button.id.replace("notice_tit_", "").trim())
      .filter((noticeSeq) => noticeSeq.length > 0);
    const normalizedSeqs = noticeSeqs.length > 0 ? noticeSeqs : fallbackNoticeSeqs;

    const results: Array<{ noticeSeq: string; bodyText: string }> = [];
    for (const noticeSeq of normalizedSeqs) {
      try {
        const { bodyText, attachments } = await resolveNoticeContent(noticeSeq);
        const attachmentBlock =
          attachments.length === 0
            ? ""
            : `\n\n[梅何颇老]\n${attachments.map((file) => `- ${file.name} (${file.url})`).join("\n")}`;
        results.push({ noticeSeq, bodyText: `${bodyText}${attachmentBlock}`.trim() });
      } catch {
        results.push({ noticeSeq, bodyText: "" });
      }
    }

    return results;
  }, lectureSeq);
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

export async function collectCu12Snapshot(
  browser: Browser,
  userId: string,
  creds: Cu12Credentials,
  onCancelCheck?: CancelCheck,
): Promise<SyncSnapshotResult> {
  const env = getEnv();
  const context = await browser.newContext(createRealisticBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  installDialogHandler(page);

  try {
    await ensureLogin(page, creds);

    if (await shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const myCourseHtml = await page.content();
    const courses = parseMyCourseHtml(myCourseHtml, userId, "ACTIVE");

    const notices: CourseNotice[] = [];
    const tasks: LearningTask[] = [];

    for (const course of courses) {
      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await page.goto(`${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      const noticeList = parseNoticeListHtml(await page.content(), userId, course.lectureSeq);
      const noticeBodies = await fetchNoticeBodies(page, course.lectureSeq);
      const fallbackBodies = noticeBodies.map((item) => item.bodyText);
      const bodiesByNoticeSeq = new Map(noticeBodies.map((item) => [item.noticeSeq, item.bodyText]));
      notices.push(
        ...noticeList.map((notice, index) => {
          const bodyText = notice.noticeSeq ? (bodiesByNoticeSeq.get(notice.noticeSeq) ?? fallbackBodies[index]) : fallbackBodies[index];
          return {
            ...notice,
            bodyText: bodyText || notice.bodyText,
          };
        }),
      );

      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await page.goto(`${env.CU12_BASE_URL}/el/class/todo_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      tasks.push(...parseTodoVodTasks(await page.content(), userId, course.lectureSeq));
    }

    if (await shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const notificationHtml = await fetchNotificationHtml(page);
    const notifications = parseNotificationListHtml(notificationHtml, userId);

    return { courses, notices, notifications, tasks };
  } finally {
    await context.close();
  }
}

async function waitForPlayback(page: Page, waitSeconds: number, shouldCancel: CancelCheck): Promise<void> {
  let remainingMs = Math.max(0, waitSeconds * 1000);
  const tickMs = 1000;

  while (remainingMs > 0) {
    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const chunkMs = Math.min(tickMs, remainingMs);
    await page.waitForTimeout(chunkMs);
    remainingMs -= chunkMs;
  }
}

async function watchVodTask(
  page: Page,
  lectureSeq: number,
  task: LearningTask,
  shouldCancel: CancelCheck,
): Promise<number> {
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
  await waitForPlayback(page, waitSeconds, shouldCancel);

  await page.evaluate(() => {
    const fn = (window as unknown as { pageExit?: (isExit?: boolean) => void }).pageExit;
    if (typeof fn === "function") {
      fn(false);
    }
  });

  await page.waitForTimeout(2000);
  return waitSeconds;
}

async function getLectureSeqs(page: Page, envBaseUrl: string, userId: string): Promise<number[]> {
  await page.goto(`${envBaseUrl}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
  const courses = parseMyCourseHtml(await page.content(), userId, "ACTIVE");
  return courses.map((course) => course.lectureSeq);
}

async function planTasks(
  page: Page,
  envBaseUrl: string,
  userId: string,
  mode: AutoLearnMode,
  lectureSeq?: number,
): Promise<PlannedTask[]> {
  const lectureSeqs =
    mode === "ALL_COURSES"
      ? await getLectureSeqs(page, envBaseUrl, userId)
      : lectureSeq
        ? [lectureSeq]
        : [];

  const planned: PlannedTask[] = [];

  for (const seq of lectureSeqs) {
    await page.goto(`${envBaseUrl}/el/class/todo_list_form.acl?LECTURE_SEQ=${seq}`, {
      waitUntil: "domcontentloaded",
    });

    const pending = parseTodoVodTasks(await page.content(), userId, seq)
      .filter((task) => task.state === "PENDING")
      .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));

    if (mode === "SINGLE_NEXT") {
      const next = pending[0];
      if (next) {
        planned.push({
          lectureSeq: seq,
          task: next,
          remainingSeconds: Math.max(0, next.requiredSeconds - next.learnedSeconds),
        });
      }
      continue;
    }

    for (const task of pending) {
      planned.push({
        lectureSeq: seq,
        task,
        remainingSeconds: Math.max(0, task.requiredSeconds - task.learnedSeconds),
      });
    }
  }

  return planned;
}

export async function runAutoLearning(
  browser: Browser,
  userId: string,
  creds: Cu12Credentials,
  options: {
    mode: AutoLearnMode;
    lectureSeq?: number;
  },
  onProgress?: (progress: AutoLearnProgress) => Promise<void> | void,
  onCancelCheck?: CancelCheck,
): Promise<AutoLearnResult> {
  const env = getEnv();
  const context = await browser.newContext(createRealisticBrowserContextOptions());
  const page = await context.newPage();
  installDialogHandler(page);
  const shouldCancel = onCancelCheck ?? (async () => false);

  try {
    await ensureLogin(page, creds);

    const mode = options.mode;
    const plannedAll = await planTasks(page, env.CU12_BASE_URL, userId, mode, options.lectureSeq);
    const truncated = plannedAll.length > env.AUTOLEARN_MAX_TASKS;
    const planned = plannedAll.slice(0, env.AUTOLEARN_MAX_TASKS);

    const estimatedTotalSeconds = planned.reduce((acc, row) => acc + Math.ceil(row.remainingSeconds * env.AUTOLEARN_TIME_FACTOR), 0);

    if (onProgress) {
      await onProgress({
        phase: "PLANNING",
        mode,
        totalTasks: planned.length,
        completedTasks: 0,
        watchedSeconds: 0,
        estimatedRemainingSeconds: estimatedTotalSeconds,
      });
    }

    let watchedTaskCount = 0;
    let watchedSeconds = 0;

    for (const row of planned) {
      if (await shouldCancel()) {
        throw new Error("AUTOLEARN_CANCELLED");
      }

      if (onProgress) {
        const consumed = watchedSeconds;
        await onProgress({
          phase: "RUNNING",
          mode,
          totalTasks: planned.length,
          completedTasks: watchedTaskCount,
          watchedSeconds,
          estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - consumed),
          current: {
            lectureSeq: row.lectureSeq,
            weekNo: row.task.weekNo,
            lessonNo: row.task.lessonNo,
            remainingSeconds: row.remainingSeconds,
          },
        });
      }

      const watched = await watchVodTask(page, row.lectureSeq, row.task, shouldCancel);
      if (watched > 0) {
        watchedTaskCount += 1;
        watchedSeconds += watched;
      }
    }

    if (onProgress) {
      await onProgress({
        phase: "DONE",
        mode,
        totalTasks: planned.length,
        completedTasks: watchedTaskCount,
        watchedSeconds,
        estimatedRemainingSeconds: 0,
      });
    }

    return {
      mode,
      watchedTaskCount,
      watchedSeconds,
      lectureSeqs: Array.from(new Set(planned.map((row) => row.lectureSeq))),
      plannedTaskCount: planned.length,
      truncated,
      estimatedTotalSeconds,
    };
  } finally {
    await context.close();
  }
}

