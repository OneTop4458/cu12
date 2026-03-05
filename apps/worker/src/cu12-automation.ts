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

export interface SyncProgress {
  phase: "COURSES" | "NOTICES" | "TASKS" | "NOTIFICATIONS" | "DONE";
  totalCourses: number;
  completedCourses: number;
  noticeCount: number;
  taskCount: number;
  notificationCount: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  current?: {
    lectureSeq: number;
    title: string;
  };
}

export type AutoLearnMode = "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";

interface PlannedTask {
  lectureSeq: number;
  courseTitle: string;
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
  heartbeatAt?: string;
  current?: {
    lectureSeq: number;
    weekNo: number;
    lessonNo: number;
    remainingSeconds: number;
    elapsedSeconds?: number;
    courseTitle?: string;
    taskTitle?: string;
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
type PlaybackTick = (state: { elapsedSeconds: number; remainingSeconds: number }) => Promise<void> | void;

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
    const normalize = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    const waitMs = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
        onclick.match(/noticeShow\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeShow\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeView\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeView\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/notice_open\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/notiOpen\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1];
      if (onClickMatch) return onClickMatch;

      const dataNoticeSeq =
        node.getAttribute("data-notice-seq")
        ?? node.getAttribute("data-notice_seq")
        ?? node.getAttribute("data-artl-seq")
        ?? node.getAttribute("data-notice-id")
        ?? node.getAttribute("data-seq");
      if (dataNoticeSeq) return dataNoticeSeq;

      const anchor = node.getAttribute("href") ?? "";
      const hrefMatch =
        anchor.match(/noticeView\.acl[^?]*\?[^#]*notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/artl_seq=(\d+)/i)?.[1]
        ?? anchor.match(/A_SEQ=(\d+)/i)?.[1]
        ?? anchor.match(/notice_id=(\d+)/i)?.[1];
      if (hrefMatch) return hrefMatch;

      return null;
    }

    function collectNoticeSeqs(): string[] {
      const rawNodes = [
        ...Array.from(document.querySelectorAll("button.notice_title[id^='notice_tit_'], button.notice_title, a.notice_title")),
        ...Array.from(
          document.querySelectorAll(
            "button.notice_title[id^='notice_tit_'], button.notice_title, a.notice_title, .notice_title, [onclick*='noticeShow'], [onclick*='noticeView'], [onclick*='notice_open'], [onclick*='notiOpen'], [data-notice-seq], [data-notice_seq], [data-artl-seq], [data-seq], .notification_title, .class_notice_title, a[href*='A_SEQ='], a[href*='notice_seq='], a[href*='artl_seq='], a[href*='notice_list_form.acl']",
          ),
        ),
      ];

      const seqs = rawNodes
        .map((node) => extractNoticeSeqFromNode(node))
        .filter((seq): seq is string => Boolean(seq));

      return Array.from(new Set(seqs));
    }

    function extractNoticeDetailUrlFromNode(node: Element, noticeSeqHint?: string): string | null {
      const href = (node.getAttribute("href") ?? "").trim();
      const onclick = node.getAttribute("onclick") ?? "";
      const pageGoUrl =
        href.match(/pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? onclick.match(/pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? "";

      const normalized = (pageGoUrl || href).replace(/&amp;/gi, "&").trim();
      if (!normalized) return null;

      if (/^https?:\/\//i.test(normalized)) {
        return /notice_list_form\.acl/i.test(normalized) ? normalized : null;
      }
      if (normalized.startsWith("/")) {
        return /notice_list_form\.acl/i.test(normalized) ? normalized : null;
      }
      if (/notice_list_form\.acl/i.test(normalized)) {
        return normalized.startsWith("?") ? `/el/class/notice_list_form.acl${normalized}` : normalized;
      }

      const noticeSeq = noticeSeqHint ?? extractNoticeSeqFromNode(node);
      if (!noticeSeq) return null;
      return `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}&encoding=utf-8`;
    }

    function collectNoticeDetailUrlBySeq(): Map<string, string> {
      const map = new Map<string, string>();
      const nodes = Array.from(
        document.querySelectorAll(
          "a[href*='A_SEQ='], a[href*='notice_seq='], a[href*='artl_seq='], a[href*='notice_list_form.acl'], [onclick*='pageGo']",
        ),
      );

      for (const node of nodes) {
        const href = node.getAttribute("href") ?? "";
        const onclick = node.getAttribute("onclick") ?? "";
        const noticeSeq =
          extractNoticeSeqFromNode(node)
          ?? href.match(/[?&]A_SEQ=(\d+)/i)?.[1]
          ?? href.match(/[?&](?:NOTICE_SEQ|notice_seq|artl_seq)=(\d+)/i)?.[1]
          ?? onclick.match(/(?:A_SEQ|NOTICE_SEQ|notice_seq|artl_seq)=(\d+)/i)?.[1]
          ?? null;
        if (!noticeSeq) continue;

        const detailUrl = extractNoticeDetailUrlFromNode(node, noticeSeq);
        if (!detailUrl) continue;

        if (!map.has(noticeSeq)) {
          map.set(noticeSeq, detailUrl);
        }
      }

      return map;
    }

    function locateNoticeTrigger(seq: string): HTMLElement | null {
      const selectors = [
        `#notice_tit_${seq}`,
        `button.notice_title#notice_tit_${seq}`,
        `a.notice_title#notice_tit_${seq}`,
        `.notice_title[data-notice-seq='${seq}']`,
        `.notice_title[data-notice_seq='${seq}']`,
        `.notice_title[data-artl-seq='${seq}']`,
        `.notice_title[data-seq='${seq}']`,
        `[onclick*="noticeShow"]`,
        `[onclick*="noticeView"]`,
        `[onclick*="notice_open"]`,
        `[onclick*="notiOpen"]`,
      ];

      const directByClickText = Array.from(document.querySelectorAll(`a, button`))
        .find((candidate) =>
          extractNoticeSeqFromNode(candidate as Element) === seq
          && ['A', 'BUTTON'].includes((candidate as Element).tagName)
        );
      if (directByClickText) {
        return directByClickText as HTMLElement;
      }

      for (const selector of selectors) {
        const target = document.querySelector(selector) as HTMLElement | null;
        if (target && /notice/i.test(target.tagName)) return target;
        if (target && extractNoticeSeqFromNode(target) === seq) return target;
      }

      return null;
    }

    async function openNotice(seq: string): Promise<boolean> {
      if (!seq) return false;
      const trigger = locateNoticeTrigger(seq);
      if (!trigger) return false;

      try {
        trigger.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
      } catch {
        // Ignore scroll failures
      }

      try {
        trigger.click();
      } catch {
        // Ignore click failures
      }

      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const extracted = extractNoticeNodeFromHtml(document, seq);
        if (extracted) return true;
        await waitMs(150);
      }
      return false;
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
        `#board_${noticeSeq}`,
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
      wrapper.querySelectorAll("script, style, link").forEach((node) => node.remove());
      const cleanupNoticeBody = (value: string): string =>
        normalize(value)
          .replace(/^(?:공지내용\s*(?:닫기\s*)?)+/i, "")
          .replace(/^해당 공지사항을 열람할 수 없습니다\.\s*/i, "")
          .trim();

      const candidates = [
        extractNoticeNodeFromHtml(wrapper, noticeSeq),
        wrapper.querySelector(
          ".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .cont, .txt, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view",
        ),
        wrapper.querySelector("textarea[name*='notice'], textarea[id*='notice'], textarea"),
        wrapper.querySelector(`#content_${noticeSeq}`),
        wrapper.querySelector(".notice_view"),
        wrapper.querySelector("#notice_view"),
        wrapper.querySelector(`#noticeArea_${noticeSeq}`),
      ];

      const body = candidates
        .map((node) => stripMarkup((node as HTMLElement) ?? document.createElement("span")))
        .find((text) => text.length > 0);

      if (body) {
        const cleaned = cleanupNoticeBody(body);
        if (cleaned) return cleaned;
      }

      const labelContainers = Array.from(wrapper.querySelectorAll("tr, li, dl, div, article"));
      for (const container of labelContainers) {
        const labelText = normalize(container.textContent ?? "");
        if (!labelText || !/공지내용/.test(labelText)) continue;

        const detailNodes = [
          container.querySelector("td"),
          container.querySelector("dd"),
          container.querySelector("textarea"),
          container.querySelector(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .cont, .txt, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view"),
          container.nextElementSibling,
        ];
        const detailText = detailNodes
          .map((node) => stripMarkup((node as HTMLElement) ?? document.createElement("span")))
          .find((text) => text.length > 0);
        if (detailText) {
          const cleaned = cleanupNoticeBody(detailText);
          if (cleaned) return cleaned;
        }
      }

      const textMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rawHtml;
      const plainText = (textMatch ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]*>/g, " ");
      const labeledBody = plainText.match(/공지내용(?:\s*닫기)?\s*공지내용?\s*([\s\S]+)/i)?.[1] ?? plainText;
      return cleanupNoticeBody(labeledBody);
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
        return dedupeAttachments(directLinks);
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

      return dedupeAttachments(fallbackRows);
    }

    function dedupeAttachments(rows: Array<{ name: string; url: string }>): Array<{ name: string; url: string }> {
      const seen = new Set<string>();
      return rows.filter((row) => {
        const key = normalize(row.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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
      const mappedDetailUrl = detailUrlBySeq.get(noticeSeq) ?? null;

       const courseSeq = String(
         Number(
           document.querySelector('input[name="COURSE_SEQ"]')?.getAttribute("value")
           ?? scriptText.match(/COURSE_SEQ\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? scriptText.match(/course_seq\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? scriptText.match(/COURSESEQ\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? String(seq),
         ),
       );

      const queryBody = new URLSearchParams({
        COURSE_SEQ: courseSeq,
        LECTURE_SEQ: String(seq),
        CUR_LECTURE_SEQ: String(seq),
        NOTICE_SEQ: noticeSeq,
        ARTL_SEQ: noticeSeq,
        CONTENTS_SEQ: noticeSeq,
        artl_seq: noticeSeq,
        notice_seq: noticeSeq,
        A_SEQ: noticeSeq,
        ARTL_NO: noticeSeq,
        NOTICE: noticeSeq,
        artl_no: noticeSeq,
        encoding: "utf-8",
      });

      const fallbackParams = new URLSearchParams({
        encoding: "utf-8",
        LECTURE_SEQ: String(seq),
        COURSE_SEQ: courseSeq,
        NOTICE_SEQ: noticeSeq,
        CUR_LECTURE_SEQ: String(seq),
        ARTL_SEQ: noticeSeq,
      });

      const queryBodyString = queryBody.toString();
      const fallbackQueryBodyString = fallbackParams.toString();
      const detailCandidates = [
        ...(mappedDetailUrl ? [{ method: "GET", url: mappedDetailUrl }] : []),
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&NOTICE_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&ARTL_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "POST", url: "/el/class/notice_list.acl", body: queryBodyString },
        { method: "POST", url: "/el/class/notice_list.acl", body: `${queryBodyString}&mode=ajax` },
        { method: "POST", url: "/el/class/notice_list.acl", body: `NOTICE_SEQ=${noticeSeq}&COURSE_SEQ=${courseSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&COURSE_SEQ=${courseSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list.acl?${queryBodyString}` },
        { method: "POST", url: "/el/class/notice_list_form.acl", body: queryBodyString },
        { method: "POST", url: "/el/class/notice_list_form.acl", body: `NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "POST", url: "/el/co/notice_detail.acl", body: queryBodyString },
        { method: "GET", url: `/el/class/notice_view_form.acl?${fallbackQueryBodyString}` },
        { method: "POST", url: "/el/class/notice_view_form.acl", body: queryBodyString },
        { method: "GET", url: `/el/class/notice_view_form.acl?${queryBodyString}` },
      ];

      const requestHtmls: string[] = [];
      await openNotice(noticeSeq);
      const inlineNode = extractNoticeNodeFromHtml(document, noticeSeq);
      if (inlineNode) {
        const inlineText = stripMarkup(inlineNode as HTMLElement);
        if (inlineText) requestHtmls.push(`<div>${inlineText}</div>`);
      }

      for (const request of detailCandidates) {
        const text = await requestText(request.url, {
          method: request.method,
          headers: request.method === "POST" ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : undefined,
          ...(request.method === "POST" ? { body: request.body } : {}),
        });
        if (text) requestHtmls.push(text);
      }

      for (const raw of requestHtmls) {
        const bodyText = parseNoticeBodyFromHtml(raw, noticeSeq);
        if (!bodyText) continue;

        const attachments = dedupeAttachments(extractAttachments(raw));
        const contentsSeq = extractContentsSeq(raw);

        if (contentsSeq) {
          const fileListText = await requestText(
            `/el/co/file_list_user4.acl?CONTENTS_SEQ=${contentsSeq}&LECTURE_SEQ=${seq}&encoding=utf-8`,
          );
          const fileAttachments = dedupeAttachments([...attachments, ...extractAttachments(fileListText)]);
          if (fileAttachments.length > 0) {
            return { bodyText, attachments: fileAttachments };
          }
        }

        return { bodyText, attachments };
      }

      return { bodyText: "", attachments: [] };
    }

    const noticeSeqs = collectNoticeSeqs();
    const detailUrlBySeq = collectNoticeDetailUrlBySeq();
    const fallbackNoticeSeqs = Array.from(document.querySelectorAll<HTMLButtonElement>("[id*='notice_tit_'], .notice_title"))
      .map((button) => button.id.match(/(\d+)/)?.[1] ?? "")
      .filter((noticeSeq) => noticeSeq.length > 0);
    const normalizedSeqs = noticeSeqs.length > 0 ? noticeSeqs : fallbackNoticeSeqs;

    const results: Array<{ noticeSeq: string; bodyText: string }> = [];
    const cached = new Map<string, string>();
    for (const noticeSeq of normalizedSeqs) {
      try {
        if (cached.has(noticeSeq)) {
          const bodyText = cached.get(noticeSeq) ?? "";
          results.push({ noticeSeq, bodyText });
          continue;
        }

        const { bodyText, attachments } = await resolveNoticeContent(noticeSeq);
        const attachmentBlock =
          attachments.length === 0
            ? ""
            : `\n\n[첨부파일]\n${attachments.map((file) => `- ${file.name} (${file.url})`).join("\n")}`;
        const normalizedBody = `${bodyText}${attachmentBlock}`.trim();
        cached.set(noticeSeq, normalizedBody);
        results.push({ noticeSeq, bodyText: normalizedBody });
      } catch {
        results.push({ noticeSeq, bodyText: "" });
      }
    }

    return results;
  }, lectureSeq);
}

async function extractNoticeBodyFromCurrentPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const cleanup = (text: string): string =>
      normalize(text)
        .replace(/^(?:공지내용\s*(?:닫기\s*)?)+/i, "")
        .replace(/^해당 공지사항을 열람할 수 없습니다\.\s*/i, "")
        .trim();

    const readNodeText = (node: Element | null): string => {
      if (!node) return "";
      if (node instanceof HTMLTextAreaElement) {
        return cleanup(node.value || node.textContent || "");
      }

      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, link").forEach((child) => child.remove());
      return cleanup(clone.textContent ?? "");
    };

    const selectors = [
      ".class_notice_content",
      ".class_notice_body",
      ".editor_content",
      ".view_cont",
      ".notice_cont",
      ".bbs_notice",
      ".bbs_contents",
      ".notice_content",
      ".notice_body",
      ".bbs_view",
      "textarea[name*='notice']",
      "textarea[id*='notice']",
      "textarea",
    ];

    for (const selector of selectors) {
      const text = readNodeText(document.querySelector(selector));
      if (text) return text;
    }

    const labelContainers = Array.from(document.querySelectorAll("tr, li, dl, div, article, section"));
    for (const container of labelContainers) {
      const labelText = normalize(container.textContent ?? "");
      if (!labelText || !/공지내용/.test(labelText)) continue;

      const detailNodes = [
        container.querySelector("td"),
        container.querySelector("dd"),
        container.querySelector("textarea"),
        container.querySelector(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view"),
        container.nextElementSibling,
      ];
      for (const node of detailNodes) {
        const text = readNodeText(node);
        if (text) return text;
      }
    }

    const plainText = normalize(document.body?.innerText ?? document.documentElement?.textContent ?? "");
    const matched = plainText.match(/공지내용(?:\s*닫기)?\s*공지내용?\s*([\s\S]+)/i)?.[1] ?? plainText;
    return cleanup(matched);
  });
}

async function fetchNoticeBodiesFromDetailPages(
  page: Page,
  lectureSeq: number,
  noticeSeqs: string[],
): Promise<Map<string, string>> {
  const env = getEnv();
  const bodyByNoticeSeq = new Map<string, string>();
  const uniqueSeqs = Array.from(new Set(noticeSeqs.filter((noticeSeq) => /^\d+$/.test(noticeSeq))));

  for (const noticeSeq of uniqueSeqs) {
    const urls = [
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&A_SEQ=${noticeSeq}&encoding=utf-8`,
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&NOTICE_SEQ=${noticeSeq}&encoding=utf-8`,
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&ARTL_SEQ=${noticeSeq}&encoding=utf-8`,
    ];

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      } catch {
        continue;
      }

      const bodyText = (await extractNoticeBodyFromCurrentPage(page)).trim();
      if (!bodyText) continue;

      bodyByNoticeSeq.set(noticeSeq, bodyText);
      break;
    }
  }

  return bodyByNoticeSeq;
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
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
): Promise<SyncSnapshotResult> {
  const env = getEnv();
  const context = await browser.newContext(createRealisticBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  const reportProgress = async (progress: SyncProgress) => {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch {
      // Ignore progress reporting failures.
    }
  };
  installDialogHandler(page);
  const startedAtMs = Date.now();
  const buildTiming = (completedCourses: number, totalCourses: number) => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    const remainingCourses = Math.max(0, totalCourses - completedCourses);
    const estimatedRemainingSeconds = completedCourses > 0
      ? Math.max(0, Math.ceil((elapsedSeconds / completedCourses) * remainingCourses))
      : null;
    return { elapsedSeconds, estimatedRemainingSeconds };
  };

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
    let completedCourses = 0;

    await reportProgress({
      phase: "COURSES",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: 0,
      ...buildTiming(completedCourses, courses.length),
    });

    for (const course of courses) {
      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await reportProgress({
        phase: "NOTICES",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });

      await page.goto(`${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      const noticeList = parseNoticeListHtml(await page.content(), userId, course.lectureSeq);
      const noticeBodies = await fetchNoticeBodies(page, course.lectureSeq);
      const fallbackBodies = noticeBodies.map((item) => item.bodyText);
      const bodiesByNoticeSeq = new Map(noticeBodies.map((item) => [item.noticeSeq, item.bodyText]));
      let resolvedNotices = noticeList.map((notice, index) => {
        const bodyText = notice.noticeSeq ? (bodiesByNoticeSeq.get(notice.noticeSeq) ?? fallbackBodies[index]) : fallbackBodies[index];
        return {
          ...notice,
          bodyText: bodyText || notice.bodyText,
        };
      });

      const missingBodyNoticeSeqs = Array.from(
        new Set(
          resolvedNotices
            .filter((notice) => !notice.bodyText?.trim() && notice.noticeSeq)
            .map((notice) => String(notice.noticeSeq)),
        ),
      );

      if (missingBodyNoticeSeqs.length > 0) {
        const detailBodiesBySeq = await fetchNoticeBodiesFromDetailPages(page, course.lectureSeq, missingBodyNoticeSeqs);
        resolvedNotices = resolvedNotices.map((notice) => {
          const noticeSeq = notice.noticeSeq ? String(notice.noticeSeq) : "";
          if (!noticeSeq || notice.bodyText?.trim()) return notice;
          const detailBodyText = detailBodiesBySeq.get(noticeSeq);
          return detailBodyText ? { ...notice, bodyText: detailBodyText } : notice;
        });
      }

      notices.push(...resolvedNotices);

      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await reportProgress({
        phase: "TASKS",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });

      await page.goto(`${env.CU12_BASE_URL}/el/class/todo_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      tasks.push(...parseTodoVodTasks(await page.content(), userId, course.lectureSeq));
      completedCourses += 1;

      await reportProgress({
        phase: "COURSES",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });
    }

    if (await shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    await reportProgress({
      phase: "NOTIFICATIONS",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: 0,
      ...buildTiming(completedCourses, courses.length),
    });

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const notificationHtml = await fetchNotificationHtml(page);
    const notifications = parseNotificationListHtml(notificationHtml, userId);

    await reportProgress({
      phase: "DONE",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: notifications.length,
      ...buildTiming(courses.length, courses.length),
    });

    return { courses, notices, notifications, tasks };
  } finally {
    await context.close();
  }
}

async function waitForPlayback(
  page: Page,
  waitSeconds: number,
  shouldCancel: CancelCheck,
  onTick?: PlaybackTick,
): Promise<void> {
  let remainingMs = Math.max(0, waitSeconds * 1000);
  const totalMs = remainingMs;
  const tickMs = 1000;

  while (remainingMs > 0) {
    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const chunkMs = Math.min(tickMs, remainingMs);
    await page.waitForTimeout(chunkMs);
    remainingMs -= chunkMs;
    if (onTick) {
      const elapsedSeconds = Math.floor((totalMs - remainingMs) / 1000);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      await onTick({ elapsedSeconds, remainingSeconds });
    }
  }
}

async function watchVodTask(
  page: Page,
  lectureSeq: number,
  task: LearningTask,
  shouldCancel: CancelCheck,
  onTick?: PlaybackTick,
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
  await waitForPlayback(page, waitSeconds, shouldCancel, onTick);

  await page.evaluate(() => {
    const fn = (window as unknown as { pageExit?: (isExit?: boolean) => void }).pageExit;
    if (typeof fn === "function") {
      fn(false);
    }
  });

  await page.waitForTimeout(2000);
  return waitSeconds;
}

async function getCourses(page: Page, envBaseUrl: string, userId: string): Promise<Array<{ lectureSeq: number; title: string }>> {
  await page.goto(`${envBaseUrl}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
  const courses = parseMyCourseHtml(await page.content(), userId, "ACTIVE");
  return courses.map((course) => ({
    lectureSeq: course.lectureSeq,
    title: course.title,
  }));
}

async function planTasks(
  page: Page,
  envBaseUrl: string,
  userId: string,
  mode: AutoLearnMode,
  lectureSeq?: number,
): Promise<PlannedTask[]> {
  const courses = await getCourses(page, envBaseUrl, userId);
  const courseTitleBySeq = new Map(courses.map((course) => [course.lectureSeq, course.title]));
  const lectureSeqs =
    mode === "ALL_COURSES"
      ? courses.map((course) => course.lectureSeq)
      : lectureSeq
        ? [lectureSeq]
        : [];

  const planned: PlannedTask[] = [];

  for (const seq of lectureSeqs) {
    await page.goto(`${envBaseUrl}/el/class/todo_list_form.acl?LECTURE_SEQ=${seq}`, {
      waitUntil: "domcontentloaded",
    });

    const pending = parseTodoVodTasks(await page.content(), userId, seq)
      .filter((task) => task.state === "PENDING" && task.activityType === "VOD")
      .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));

    if (mode === "SINGLE_NEXT") {
      const next = pending[0];
      if (next) {
        planned.push({
          lectureSeq: seq,
          courseTitle: courseTitleBySeq.get(seq) ?? `Course ${seq}`,
          task: next,
          remainingSeconds: Math.max(0, next.requiredSeconds - next.learnedSeconds),
        });
      }
      continue;
    }

    for (const task of pending) {
      planned.push({
        lectureSeq: seq,
        courseTitle: courseTitleBySeq.get(seq) ?? `Course ${seq}`,
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
    const heartbeatIntervalSeconds = Math.max(10, env.AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS);
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
        heartbeatAt: new Date().toISOString(),
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
        const plannedWaitSeconds = Math.ceil(row.remainingSeconds * env.AUTOLEARN_TIME_FACTOR);
        await onProgress({
          phase: "RUNNING",
          mode,
          totalTasks: planned.length,
          completedTasks: watchedTaskCount,
          watchedSeconds,
          estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - consumed),
          heartbeatAt: new Date().toISOString(),
          current: {
            lectureSeq: row.lectureSeq,
            weekNo: row.task.weekNo,
            lessonNo: row.task.lessonNo,
            remainingSeconds: plannedWaitSeconds,
            elapsedSeconds: 0,
            courseTitle: row.courseTitle,
            taskTitle: row.task.taskTitle,
          },
        });
      }

      let lastReportedElapsedSeconds = 0;
      const watched = await watchVodTask(
        page,
        row.lectureSeq,
        row.task,
        shouldCancel,
        async ({ elapsedSeconds, remainingSeconds }) => {
          if (!onProgress) return;
          if (remainingSeconds > 0 && elapsedSeconds % heartbeatIntervalSeconds !== 0) return;
          if (elapsedSeconds <= lastReportedElapsedSeconds && remainingSeconds > 0) return;

          lastReportedElapsedSeconds = elapsedSeconds;
          const consumed = watchedSeconds + elapsedSeconds;
          await onProgress({
            phase: "RUNNING",
            mode,
            totalTasks: planned.length,
            completedTasks: watchedTaskCount,
            watchedSeconds: consumed,
            estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - consumed),
            heartbeatAt: new Date().toISOString(),
            current: {
              lectureSeq: row.lectureSeq,
              weekNo: row.task.weekNo,
              lessonNo: row.task.lessonNo,
              remainingSeconds,
              elapsedSeconds,
              courseTitle: row.courseTitle,
              taskTitle: row.task.taskTitle,
            },
          });
        },
      );
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
        heartbeatAt: new Date().toISOString(),
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



