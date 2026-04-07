import {
  parseMyCourseHtml,
  parseNoticeListHtml,
  parseNotificationListHtml,
  parseTodoTasks,
  type CourseNotice,
  type LearningTask,
} from "@cu12/core";
import { load } from "cheerio";
import { getEnv } from "./env";
import type { Cu12Credentials, SyncProgress, SyncSnapshotResult } from "./cu12-automation";

interface Cu12LoginResponse {
  isError?: boolean;
  message?: string;
  messageCode?: string;
}

interface HttpTextResponse {
  status: number;
  url: string;
  text: string;
}

type CancelCheck = () => Promise<boolean>;

class Cu12SessionClient {
  private readonly baseUrl: string;
  private readonly cookieJar = new Map<string, string>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async login(creds: Cu12Credentials): Promise<void> {
    await this.getText("/el/member/login_form.acl");

    const body = new URLSearchParams({
      univ_id: creds.campus === "SONGSIN" ? "songsin" : "catholic",
      usr_id: creds.cu12Id,
      usr_pwd: creds.cu12Password,
      se_flag: "",
      returnURL: "/el/main/main_form.acl",
      returnSNO: "",
      remember: "N",
      encoding: "utf-8",
    });

    const response = await this.postForm("/el/lo/hak_login_proc.acl", body, {
      "x-requested-with": "XMLHttpRequest",
    });

    if (response.status >= 400) {
      throw new Error(`CU12 login request failed (${response.status})`);
    }

    let parsed: Cu12LoginResponse;
    try {
      parsed = JSON.parse(response.text) as Cu12LoginResponse;
    } catch {
      throw new Error("CU12 login response parse failed");
    }

    if (parsed.isError) {
      throw new Error(parsed.message ?? "CU12 login failed");
    }

    const myCourse = await this.getText("/el/member/mycourse_list_form.acl");
    this.assertAuthenticated(myCourse);
  }

  async getText(path: string): Promise<HttpTextResponse> {
    return this.requestText(path, { method: "GET" });
  }

  async postForm(
    path: string,
    body: URLSearchParams,
    headers?: Record<string, string>,
  ): Promise<HttpTextResponse> {
    return this.requestText(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        ...(headers ?? {}),
      },
      body: body.toString(),
    });
  }

  assertAuthenticated(response: HttpTextResponse): void {
    if (/\/el\/member\/login_form\.acl/i.test(response.url)) {
      throw new Error("CU12 login required");
    }

    const looksLikeLoginForm =
      /(id|name)=["'](?:usr_id|usr_id2|pwd|pwd2)["']/i.test(response.text)
      && /(id|name)=["'](?:loginBtn_check1|loginBtn_check2)["']/i.test(response.text);
    if (looksLikeLoginForm) {
      throw new Error("CU12 login required");
    }
  }

  private async requestText(
    path: string,
    init: {
      method: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<HttpTextResponse> {
    const url = new URL(path, this.baseUrl).toString();
    const headers = new Headers(init.headers ?? {});
    const cookies = this.renderCookieHeader();
    if (cookies) {
      headers.set("cookie", cookies);
    }

    const env = getEnv();
    if (env.PLAYWRIGHT_USER_AGENT && !headers.has("user-agent")) {
      headers.set("user-agent", env.PLAYWRIGHT_USER_AGENT);
    }

    const response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: "follow",
      cache: "no-store",
    });

    this.captureCookies(response);
    const text = await response.text();
    return { status: response.status, url: response.url, text };
  }

  private renderCookieHeader(): string {
    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private captureCookies(response: Response): void {
    const headersWithSetCookie = response.headers as unknown as {
      getSetCookie?: () => string[];
    };

    const rawCookies = headersWithSetCookie.getSetCookie?.()
      ?? splitSetCookieHeader(response.headers.get("set-cookie"));
    for (const rawCookie of rawCookies) {
      const cookiePart = rawCookie.split(";")[0]?.trim();
      if (!cookiePart) continue;
      const index = cookiePart.indexOf("=");
      if (index <= 0) continue;
      const name = cookiePart.slice(0, index).trim();
      const value = cookiePart.slice(index + 1).trim();
      if (!name) continue;
      this.cookieJar.set(name, value);
    }
  }
}

function splitSetCookieHeader(rawHeader: string | null): string[] {
  if (!rawHeader) return [];
  const values: string[] = [];
  let start = 0;
  let inExpires = false;

  for (let index = 0; index < rawHeader.length; index += 1) {
    const chunk = rawHeader.slice(index, index + 8).toLowerCase();
    if (chunk === "expires=") {
      inExpires = true;
      continue;
    }

    const char = rawHeader[index];
    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (!inExpires && char === ",") {
      const value = rawHeader.slice(start, index).trim();
      if (value) values.push(value);
      start = index + 1;
    }
  }

  const tail = rawHeader.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function loadHtmlFragment(rawHtml: string) {
  const $ = load(rawHtml, null, false);
  $("script, style, link").remove();
  return $;
}

function stripTags(value: string): string {
  return loadHtmlFragment(value).root().text();
}

function cleanupNoticeBody(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^(?:\uACF5\uC9C0\uB0B4\uC6A9\s*)+/i, "")
    .replace(/^\uD574\uB2F9\s*\uACF5\uC9C0\uC0AC\uD56D\uC744\s*\uC5F4\uB78C\uD560\s*\uC218\s*\uC5C6\uC2B5\uB2C8\uB2E4\.?\s*/i, "")
    .trim();
}

function scoreNoticeBody(value: string): number {
  const text = normalizeWhitespace(value);
  if (!text) return -1;

  let score = 0;
  if (text.length >= 40) score += 2;
  else if (text.length >= 15) score += 1;
  else score -= 1;

  const metaPatterns = [
    /\uC870\uD68C\uC218/i,
    /\uB4F1\uB85D\uC77C/i,
    /\uC791\uC131\uC77C/i,
    /\uC791\uC131\uC790/i,
    /\uACF5\uC9C0\s*\uC0AC\uD56D/i,
  ];
  const metaHits = metaPatterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const hasDate = /\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/.test(text);

  if (metaHits >= 2 && text.length <= 220) score -= 3;
  if (hasDate && metaHits >= 1 && text.length <= 220) score -= 2;
  if (/\uC870\uD68C\uC218/i.test(text) && text.length <= 260) score -= 3;

  return score;
}

function isLikelyNoticeBody(value: string): boolean {
  return scoreNoticeBody(value) > 0;
}

function parseBodyFromNoticeDetailHtml(rawHtml: string, noticeSeq: string): string {
  const $ = loadHtmlFragment(rawHtml);

  const scopedSelectors = [
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
    ".class_notice_body",
    ".class_notice_content",
    ".editor_content",
    ".view_cont",
    ".notice_view",
    ".bbs_contents",
    ".bbs_view",
    "textarea[name*='notice']",
    "textarea[id*='notice']",
  ];

  for (const selector of scopedSelectors) {
    const node = $(selector).first();
    if (!node.length) continue;
    const body = cleanupNoticeBody(normalizeWhitespace(node.text()));
    if (body) return body;
  }

  for (const element of $("tr, li, dl, div, article").toArray()) {
    const container = $(element);
    const labelText = normalizeWhitespace(container.text());
    if (!labelText || !/(?:\uACF5\uC9C0\uB0B4\uC6A9|notice\s*content)/i.test(labelText)) continue;

    const detailCandidates = [
      container.find("td").first(),
      container.find("dd").first(),
      container.find("textarea").first(),
      container.find(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_view, .bbs_contents, .bbs_view").first(),
      container.next(),
    ];

    for (const candidate of detailCandidates) {
      if (!candidate.length) continue;
      const body = cleanupNoticeBody(normalizeWhitespace(candidate.text()));
      if (body) return body;
    }
  }

  const fallback = cleanupNoticeBody(normalizeWhitespace($.root().text()));
  return fallback.length >= 20 ? fallback : "";
}

function extractCourseSeqFromHtml(rawHtml: string, lectureSeq: number): string {
  const patterns = [
    /<input[^>]*name=["']COURSE_SEQ["'][^>]*value=["']?(\d+)["']?/i,
    /COURSE_SEQ\s*[:=]\s*["']?(\d+)["']?/i,
    /course_seq\s*[:=]\s*["']?(\d+)["']?/i,
    /COURSESEQ\s*[:=]\s*["']?(\d+)["']?/i,
  ];

  for (const pattern of patterns) {
    const found = rawHtml.match(pattern)?.[1];
    if (found) return found;
  }

  return String(lectureSeq);
}

function extractContentsSeq(rawHtml: string): string | null {
  const patterns = [
    /CONTENTS_SEQ\s*[:=]\s*["']?(\d+)["']?/i,
    /contentSeq\s*[:=]\s*["']?(\d+)["']?/i,
    /course_contents_seq\s*[:=]\s*["']?(\d+)["']?/i,
  ];

  for (const pattern of patterns) {
    const found = rawHtml.match(pattern)?.[1];
    if (found) return found;
  }

  return null;
}

function extractViewCountFromHtml(rawHtml: string): string | null {
  const text = normalizeWhitespace(stripTags(rawHtml));
  if (!text) return null;

  const labeled = text.match(/(?:\uC870\uD68C\uC218|view\s*count)\s*[:：]?\s*(\d{1,9})/i)?.[1];
  if (labeled) return labeled;

  return null;
}

function isLikelyAttachmentUrl(url: string): boolean {
  const normalized = url.toLowerCase();

  if (
    /\/el\/member\/profile_view_form\.acl/.test(normalized)
    || /\/el\/class\/file_list_form\.acl/.test(normalized)
    || /\/el\/co\/file_list_user4\.acl/.test(normalized)
  ) {
    return false;
  }

  if (/\.(?:pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx|zip|rar|7z|txt|jpg|jpeg|png|gif|bmp|mp4|mp3|wav)$/i.test(normalized)) {
    return true;
  }

  return /(?:download|down_file|file_down|filedownload|contents_file_seq|file_seq|atch_file|file_id|attach_id|attachment)/i.test(normalized);
}

function extractAttachments(rawHtml: string, baseUrl: string): Array<{ name: string; url: string }> {
  const dedup = new Map<string, { name: string; url: string }>();
  const $ = loadHtmlFragment(rawHtml);

  for (const element of $("a[href], a[data-href]").toArray()) {
    const link = $(element);
    const rawHref = decodeHtmlEntities(link.attr("href") ?? link.attr("data-href") ?? "").trim();
    if (!rawHref || /^javascript:/i.test(rawHref)) continue;

    const name = normalizeWhitespace(link.text());
    if (!name) continue;

    let absoluteUrl = rawHref;
    try {
      absoluteUrl = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }

    if (!isLikelyAttachmentUrl(absoluteUrl)) continue;

    if (!dedup.has(absoluteUrl)) {
      dedup.set(absoluteUrl, { name, url: absoluteUrl });
    }
  }

  return [...dedup.values()];
}

function appendAttachmentBlock(
  bodyText: string,
  attachments: Array<{ name: string; url: string }>,
): string {
  if (attachments.length === 0) {
    return bodyText.trim();
  }

  const block = attachments.map((item) => `- ${item.name} (${item.url})`).join("\n");
  return `${bodyText.trim()}\n\n[\uCCA8\uBD80\uD30C\uC77C]\n${block}`.trim();
}

function composeNoticeBodyWithMeta(
  bodyText: string,
  meta: {
    postedAt: string | null;
    author: string | null;
    viewCount: string | null;
  },
): string {
  const body = bodyText.trim();
  const lines: string[] = [];
  if (meta.postedAt) lines.push(`\uC791\uC131\uC77C: ${meta.postedAt}`);
  if (meta.author) lines.push(`\uC791\uC131\uC790: ${meta.author}`);
  if (meta.viewCount) lines.push(`\uC870\uD68C\uC218: ${meta.viewCount}`);

  if (lines.length === 0) return body;
  const metaBlock = lines.join("\n");
  if (!body) return metaBlock;

  // Prevent duplicate metadata when CU12 detail HTML already includes header fields.
  if (/(?:\uC791\uC131\uC77C|\uC791\uC131\uC790|\uC870\uD68C\uC218)/.test(body)) {
    return body;
  }

  return `${metaBlock}\n\n${body}`;
}

function buildNoticeDetailCandidates(
  lectureSeq: number,
  noticeSeq: string,
  courseSeq: string,
): Array<{
  method: "GET" | "POST";
  path: string;
  body?: URLSearchParams;
}> {
  const queryBody = new URLSearchParams({
    COURSE_SEQ: courseSeq,
    LECTURE_SEQ: String(lectureSeq),
    CUR_LECTURE_SEQ: String(lectureSeq),
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

  const fallbackBody = new URLSearchParams({
    encoding: "utf-8",
    LECTURE_SEQ: String(lectureSeq),
    COURSE_SEQ: courseSeq,
    NOTICE_SEQ: noticeSeq,
    CUR_LECTURE_SEQ: String(lectureSeq),
    ARTL_SEQ: noticeSeq,
  });

  return [
    { method: "GET", path: `/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&A_SEQ=${noticeSeq}&encoding=utf-8` },
    { method: "GET", path: `/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&A_SEQ=${noticeSeq}` },
    { method: "GET", path: `/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&NOTICE_SEQ=${noticeSeq}&encoding=utf-8` },
    { method: "GET", path: `/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&ARTL_SEQ=${noticeSeq}&encoding=utf-8` },
    { method: "POST", path: "/el/class/notice_list.acl", body: queryBody },
    {
      method: "POST",
      path: "/el/class/notice_list.acl",
      body: new URLSearchParams(`${queryBody.toString()}&mode=ajax`),
    },
    {
      method: "POST",
      path: "/el/class/notice_list.acl",
      body: new URLSearchParams({
        NOTICE_SEQ: noticeSeq,
        COURSE_SEQ: courseSeq,
        LECTURE_SEQ: String(lectureSeq),
        encoding: "utf-8",
      }),
    },
    {
      method: "GET",
      path: `/el/class/notice_list.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${lectureSeq}&COURSE_SEQ=${courseSeq}&encoding=utf-8`,
    },
    { method: "GET", path: `/el/class/notice_list.acl?${queryBody.toString()}` },
    { method: "POST", path: "/el/class/notice_list_form.acl", body: queryBody },
    {
      method: "POST",
      path: "/el/class/notice_list_form.acl",
      body: new URLSearchParams({
        NOTICE_SEQ: noticeSeq,
        LECTURE_SEQ: String(lectureSeq),
        encoding: "utf-8",
      }),
    },
    {
      method: "GET",
      path: `/el/class/notice_list_form.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${lectureSeq}&encoding=utf-8`,
    },
    { method: "POST", path: "/el/co/notice_detail.acl", body: queryBody },
    { method: "POST", path: "/el/class/notice_view_form.acl", body: queryBody },
    { method: "GET", path: `/el/class/notice_view_form.acl?${fallbackBody.toString()}` },
  ];
}

function pickBodyFromParsedNoticeList(
  html: string,
  userId: string,
  lectureSeq: number,
  noticeSeq: string,
): string {
  const parsed = parseNoticeListHtml(html, userId, lectureSeq);
  if (parsed.length === 0) return "";

  const exact = parsed.find((row) => row.noticeSeq === noticeSeq && row.bodyText.trim().length > 0);
  return exact?.bodyText?.trim() ?? "";
}

async function resolveNoticeBodyViaHttp(input: {
  client: Cu12SessionClient;
  userId: string;
  lectureSeq: number;
  noticeSeq: string;
  courseSeq: string;
  shouldCancel: CancelCheck;
}): Promise<{ bodyText: string; viewCount: string | null }> {
  const env = getEnv();
  const candidates = buildNoticeDetailCandidates(input.lectureSeq, input.noticeSeq, input.courseSeq);
  let best: { bodyText: string; score: number; viewCount: string | null } | null = null;

  for (const candidate of candidates) {
    if (await input.shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    const response = candidate.method === "POST"
      ? await input.client.postForm(candidate.path, candidate.body ?? new URLSearchParams())
      : await input.client.getText(candidate.path);
    input.client.assertAuthenticated(response);
    if (response.status >= 400 || !response.text.trim()) continue;

    const parsedBody = pickBodyFromParsedNoticeList(
      response.text,
      input.userId,
      input.lectureSeq,
      input.noticeSeq,
    );
    const detailBody = parsedBody || parseBodyFromNoticeDetailHtml(response.text, input.noticeSeq);
    if (!detailBody || !isLikelyNoticeBody(detailBody)) continue;

    let attachments = extractAttachments(response.text, env.CU12_BASE_URL);
    const contentsSeq = extractContentsSeq(response.text);
    if (contentsSeq) {
      const fileResponse = await input.client.getText(
        `/el/co/file_list_user4.acl?CONTENTS_SEQ=${contentsSeq}&LECTURE_SEQ=${input.lectureSeq}&encoding=utf-8`,
      );
      input.client.assertAuthenticated(fileResponse);
      attachments = mergeAttachments(attachments, extractAttachments(fileResponse.text, env.CU12_BASE_URL));
    }

    const bodyText = appendAttachmentBlock(detailBody, attachments);
    const score = scoreNoticeBody(detailBody);
    const viewCount = extractViewCountFromHtml(response.text);
    if (!best || score > best.score || (score === best.score && bodyText.length > best.bodyText.length)) {
      best = { bodyText, score, viewCount };
    }
    if (score >= 3) {
      return { bodyText, viewCount };
    }
  }

  return {
    bodyText: best?.bodyText ?? "",
    viewCount: best?.viewCount ?? null,
  };
}

function mergeAttachments(
  current: Array<{ name: string; url: string }>,
  candidate: Array<{ name: string; url: string }>,
): Array<{ name: string; url: string }> {
  const dedup = new Map<string, { name: string; url: string }>();
  for (const row of [...current, ...candidate]) {
    if (!dedup.has(row.url)) {
      dedup.set(row.url, row);
    }
  }
  return [...dedup.values()];
}

function upsertNoticeBodies(
  notices: CourseNotice[],
  detailBySeq: Map<string, { bodyText: string; viewCount: string | null }>,
): CourseNotice[] {
  return notices.map((notice) => {
    const seq = notice.noticeSeq ? String(notice.noticeSeq) : "";
    if (!seq || notice.bodyText.trim()) return notice;
    const detail = detailBySeq.get(seq);
    if (!detail?.bodyText.trim()) return notice;

    return {
      ...notice,
      bodyText: composeNoticeBodyWithMeta(detail.bodyText, {
        postedAt: notice.postedAt,
        author: notice.author,
        viewCount: detail.viewCount,
      }),
    };
  });
}

export async function collectCu12SnapshotViaHttp(
  userId: string,
  creds: Cu12Credentials,
  onCancelCheck?: CancelCheck,
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
): Promise<SyncSnapshotResult> {
  const env = getEnv();
  const client = new Cu12SessionClient(env.CU12_BASE_URL);
  const shouldCancel = onCancelCheck ?? (async () => false);
  const reportProgress = async (progress: SyncProgress) => {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch {
      // Ignore progress reporting failures.
    }
  };

  const startedAtMs = Date.now();
  const buildTiming = (completedCourses: number, totalCourses: number) => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    const remainingCourses = Math.max(0, totalCourses - completedCourses);
    const estimatedRemainingSeconds = completedCourses > 0
      ? Math.max(0, Math.ceil((elapsedSeconds / completedCourses) * remainingCourses))
      : null;
    return { elapsedSeconds, estimatedRemainingSeconds };
  };

  await client.login(creds);

  if (await shouldCancel()) {
    throw new Error("JOB_CANCELLED");
  }

  const myCourseResponse = await client.getText("/el/member/mycourse_list_form.acl");
  client.assertAuthenticated(myCourseResponse);
  const courses = parseMyCourseHtml(myCourseResponse.text, userId, "ACTIVE");

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

    const noticeListResponse = await client.getText(
      `/el/class/notice_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`,
    );
    client.assertAuthenticated(noticeListResponse);
    const noticeList = parseNoticeListHtml(noticeListResponse.text, userId, course.lectureSeq);
    const courseSeq = extractCourseSeqFromHtml(noticeListResponse.text, course.lectureSeq);

    const missingBodyNoticeSeqs = Array.from(
      new Set(
        noticeList
          .filter((notice) => !notice.bodyText?.trim() && notice.noticeSeq)
          .map((notice) => String(notice.noticeSeq)),
      ),
    );
    const detailBodyBySeq = new Map<string, { bodyText: string; viewCount: string | null }>();

    for (const noticeSeq of missingBodyNoticeSeqs) {
      const detail = await resolveNoticeBodyViaHttp({
        client,
        userId,
        lectureSeq: course.lectureSeq,
        noticeSeq,
        courseSeq,
        shouldCancel,
      });
      if (detail.bodyText.trim()) {
        detailBodyBySeq.set(noticeSeq, {
          bodyText: detail.bodyText.trim(),
          viewCount: detail.viewCount,
        });
      }
    }

    notices.push(...upsertNoticeBodies(noticeList, detailBodyBySeq));

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

    const taskResponse = await client.getText(`/el/class/todo_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`);
    client.assertAuthenticated(taskResponse);
    tasks.push(...parseTodoTasks(taskResponse.text, userId, course.lectureSeq));
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

  const notificationResponse = await client.postForm(
    "/el/co/notification_list.acl",
    new URLSearchParams({ encoding: "utf-8" }),
  );
  client.assertAuthenticated(notificationResponse);
  const notifications = parseNotificationListHtml(notificationResponse.text, userId);

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
}
