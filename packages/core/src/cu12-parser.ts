import { load } from "cheerio";
import type { CourseNotice, CourseState, LearningTask, NotificationEvent } from "./types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDateText(raw: string | null | undefined): string {
  if (!raw) return "";
  return normalizeWhitespace(
    raw
      .replace(/\u00a0/g, " ")
      .replace(/\uC624\uC804/gi, "AM")
      .replace(/\uC624\uD6C4/gi, "PM")
      .replace(/\uC815\uC624/gi, "PM")
      .replace(/\uC790\uC815/gi, "AM")
      .replace(/[\uFF5E\u301C]/g, "-")
      .replace(/\u3000/g, " "),
  );
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\([^)]*\)/g, "").replace(/\s+/g, "").trim();
  const match = cleaned.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function toIsoDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = normalizeDateText(raw).replace(/\([^)]*\)/g, "");

  const dateOnlyMatch = cleaned.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!dateOnlyMatch) return null;

  const dateMatch = cleaned.match(
    /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})(?:\s*(AM|PM))?(?:\s+(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?/i,
  );
  if (!dateMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2].padStart(2, "0")}-${dateOnlyMatch[3].padStart(2, "0")}T00:00:00+09:00`;
  }

  const year = dateMatch[1];
  const month = dateMatch[2].padStart(2, "0");
  const day = dateMatch[3].padStart(2, "0");
  const period = (dateMatch[4] ?? "").toUpperCase();
  const rawHour = Number(dateMatch[5]);
  if (!Number.isFinite(rawHour)) {
    return `${year}-${month}-${day}T00:00:00+09:00`;
  }

  let hour = rawHour;
  const minute = (dateMatch[6] ?? "00").padStart(2, "0");
  const second = (dateMatch[7] ?? "00").padStart(2, "0");
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;

  const normalizedHour = String(hour).padStart(2, "0");
  return `${year}-${month}-${day}T${normalizedHour}:${minute}:${second}+09:00`;
}

function extractDateTimeCandidates(raw: string): string[] {
  const normalized = normalizeDateText(raw);
  const dateTimePattern = /(\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}(?:\s*(?:AM|PM))?(?:\s+\d{1,2}(?::\d{2}){0,2})?)/g;
  const results: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = dateTimePattern.exec(normalized)) !== null) {
    const candidate = normalizeWhitespace(match[1]);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    results.push(candidate);
  }

  return results;
}

function parseDateRangeFromText(raw: string): { availableFrom: string | null; dueAt: string | null } | null {
  const candidates = extractDateTimeCandidates(raw);
  if (candidates.length >= 2) {
    const availableFrom = toIsoDateTime(candidates[0]);
    const dueAt = toIsoDateTime(candidates[1]);
    if (availableFrom || dueAt) {
      return { availableFrom, dueAt };
    }
  }
  return null;
}

function parseTaskWindow(raw: string): { availableFrom: string | null; dueAt: string | null } | null {
  const normalized = normalizeDateText(raw);

  const labeledRange = normalized.match(/(?:학습인정기간|학습인정|응시기간|시험기간|제출기간|과제기간|마감일|마감|차시기간|진도인정)\s*[:\-]?\s*([\s\S]+)/i);
  if (labeledRange?.[1]) {
    const directRange = parseDateRangeFromText(labeledRange[1]);
    if (directRange) return directRange;
  }

  const directRange = parseDateRangeFromText(normalized);
  if (directRange) return directRange;

  const dueOnly = normalized.match(/(\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}(?:\s*(?:AM|PM))?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?)/);
  if (dueOnly?.[1]) {
    const dueAt = toIsoDateTime(dueOnly[1]);
    return { availableFrom: null, dueAt };
  }

  return null;
}

function parseDurationToSeconds(raw: string | null | undefined): number {
  if (!raw) return 0;
  const normalized = normalizeWhitespace(raw);

  const clockMatch = normalized.match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/);
  if (clockMatch) {
    return Number(clockMatch[1]) * 3600 + Number(clockMatch[2]) * 60 + Number(clockMatch[3] ?? 0);
  }

  const hours = Number(normalized.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const minutes = Number(normalized.match(/(\d+)\s*분/)?.[1] ?? 0);
  const seconds = Number(normalized.match(/(\d+)\s*초/)?.[1] ?? 0);
  if (hours > 0 || minutes > 0 || seconds > 0) {
    return hours * 3600 + minutes * 60 + seconds;
  }

  const fallback = Number(normalized.match(/\d+/)?.[0] ?? 0);
  return fallback;
}

function normalizeNoticeText(raw: string): string {
  return normalizeWhitespace(raw)
    .replace(/^공지\s*/g, "")
    .replace(/^\[[^\]]+\]\s*/g, "")
    .trim();
}

function parseNoticeSeqFromNode(node: any): string | null {
  const id = node.attr("id")?.trim();
  const idMatch = id?.match(/notice_tit_(\d+)/)?.[1];
  if (idMatch) return idMatch;

  const onclick = node.attr("onclick") ?? "";
  return (
    onclick.match(/noticeShow\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? onclick.match(/noticeShow\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? onclick.match(/noticeView\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? onclick.match(/noticeView\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? onclick.match(/notice_open\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? onclick.match(/notiOpen\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
    ?? node.attr("data-notice-seq")
    ?? node.attr("data-notice_seq")
    ?? node.attr("data-artl-seq")
    ?? node.attr("data-seq")
    ?? node.attr("href")?.match(/notice_seq=(\d+)/i)?.[1]
    ?? node.attr("href")?.match(/artl_seq=(\d+)/i)?.[1]
    ?? node.attr("href")?.match(/NOTICE_SEQ=(\d+)/i)?.[1]
    ?? node.attr("href")?.match(/A_SEQ=(\d+)/i)?.[1]
    ?? null
  );
}

function parseNoticeBodyCandidates(
  $: ReturnType<typeof load>,
  source: any,
  noticeSeq: string | null,
): string {
  const bodySelectors = [
    `#notice_${noticeSeq}`,
    `#notice_txt_${noticeSeq}`,
    `#notice-content-${noticeSeq}`,
    `#notice-content_${noticeSeq}`,
    `#notice_body_${noticeSeq}`,
    `#noticeArea_${noticeSeq}`,
    `#board_${noticeSeq}`,
    `.notice_${noticeSeq}`,
    `.notice-content-${noticeSeq}`,
    `.notice-content_${noticeSeq}`,
    `.notice-body-${noticeSeq}`,
    `.notice_body_${noticeSeq}`,
    `.class_notice_content_${noticeSeq}`,
    `.class_notice_body_${noticeSeq}`,
    `.editor_content_${noticeSeq}`,
  ].filter((selector): selector is string => Boolean(selector));

  const nearby = source.closest("li, tr, dd, dl, article, div, .accordion_item, .notice_item, .board_item, .notice_list").first();
  const candidates = [
    source.parent().find("textarea, .view_cont, .notice_cont, .cont, .txt, .contents").first(),
    source.next(),
    source.parent().next(),
    nearby,
    nearby.find(".class_notice_body, .class_notice_content, .editor_content, .view_cont, .notice_cont, .cont, .txt, .bbs_notice").first(),
    nearby.find(".notice_view, .notice-detail, .notice_content, .notice-body, .notice_body, .bbs_contents").first(),
    nearby.find(".notice_txt").first(),
    $(".notice-content, .notice_content, .editor_content").first(),
    ...bodySelectors.map((selector) => $(selector)),
  ];

  const candidateText = candidates
    .map((item) => normalizeNoticeText(item?.text() ?? ""))
    .find((value) => value.length > 0);

  return candidateText ?? "";
}

export function parseMyCourseHtml(html: string, userId: string, status: CourseState["status"] = "ACTIVE"): CourseState[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const seen = new Set<number>();
  const items: CourseState[] = [];

  $('a[href^="javascript:enterClass("]').each((_, el) => {
    const link = $(el);
    const href = link.attr("href") ?? "";
    const lectureSeqMatch = href.match(/enterClass\((\d+)\)/);
    const lectureSeq = Number(lectureSeqMatch?.[1] ?? 0);

    if (!lectureSeq || seen.has(lectureSeq)) return;
    seen.add(lectureSeq);

    let card = link.parent();
    while (card.length > 0) {
      const text = normalizeWhitespace(card.text());
      if (/\d+%/.test(text)) break;
      card = card.parent();
    }

    const cardText = normalizeWhitespace(card.text());
    const title = normalizeWhitespace(link.text()).replace(/\s*강좌\s*$/, "");
    const instructor = normalizeWhitespace(card.find('a[href^="javascript:goProfile("]').first().text()) || null;
    const progressPercent = Number(cardText.match(/(\d+)\s*%/)?.[1] ?? 0);
    const remainDays = Number(cardText.match(/(\d+)\s*일/)?.[1] ?? Number.NaN);
    const recentLearnedAt = toIsoDate(cardText.match(/(\d{4}\.\d{1,2}\.\d{1,2}(?:\([^)]*\))?)/)?.[1]);

    const periodRange = cardText.match(
      /(\d{4}\.\d{1,2}\.\d{1,2}(?:\([^)]*\))?\s*~\s*\d{4}\.\d{1,2}\.\d{1,2}(?:\([^)]*\))?)/,
    )?.[1] ?? null;
    const [rawStart, rawEnd] = periodRange ? periodRange.split("~").map((v) => v.trim()) : [null, null];

    items.push({
      userId,
      lectureSeq,
      title,
      instructor,
      progressPercent,
      remainDays: Number.isFinite(remainDays) ? remainDays : null,
      recentLearnedAt,
      periodStart: toIsoDate(rawStart),
      periodEnd: toIsoDate(rawEnd),
      status,
      syncedAt,
    });
  });

  return items;
}

function detectNoticeListContext($: ReturnType<typeof load>, node: any): string {
  const nearby = node.closest("li, tr, .board_item, .notice_item, .accordion_item, .card, .notice_area").first();
  return normalizeWhitespace(`${node.text()} ${nearby.text()}`);
}

function stableHashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildFallbackNoticeKey(
  lectureSeq: number,
  title: string,
  author: string | null,
  postedAt: string | null,
): string {
  const keySource = [
    String(lectureSeq),
    normalizeNoticeText(title).toLowerCase(),
    normalizeNoticeText(author ?? "").toLowerCase(),
    postedAt ?? "",
  ].join("|");
  return `${lectureSeq}:meta:${stableHashText(keySource)}`;
}

export function parseNoticeListHtml(html: string, userId: string, lectureSeq: number): CourseNotice[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const notices: CourseNotice[] = [];
  const seen = new Set<string>();

  const rawCandidates = $(
    [
      'button[id^="notice_tit_"]',
      "button.notice_title",
      "a.notice_title",
      "a[class*='notice']",
      "a[href*='A_SEQ=']",
      "a[href*='NOTICE_SEQ=']",
      "a[href*='notice_seq=']",
      "a[href*='artl_seq=']",
      "a[href*='notice_list_form.acl']",
      ".notice_title",
      ".class_notice_title",
      "[onclick*='noticeShow']",
      "[onclick*='noticeView']",
      "[onclick*='notice_open']",
      "[onclick*='notiOpen']",
      "[data-notice-seq]",
      "[data-notice_seq]",
      "[data-notice-id]",
      "[id^='notice_tit_']",
    ].join(", "),
  );

  for (const el of rawCandidates.toArray()) {
    const node = $(el);
    const lineText = normalizeNoticeText(node.text());
    if (!lineText) continue;

    const noticeSeq = parseNoticeSeqFromNode(node);
    const title =
      normalizeNoticeText(
        node.find('.class_notice_title_sub, .class_notice_title, .notice_title, .title').first().text(),
      ) || lineText.split(/\s{2,}|\n/)[0]?.trim() || lineText || "공지";

    const infoText = detectNoticeListContext($, node);
    const postedAtMatch = infoText.match(/(\d{4}\.\d{1,2}\.\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
    const postedAt = toIsoDate(postedAtMatch?.[1] ?? null);
    const author = normalizeNoticeText(
      node.closest("li, tr, .board_item, .notice_item").find('.writer, .author, .regist, .reg, .notice-writer, .name').first().text(),
    ) || null;
    const noticeKey = noticeSeq
      ? `${lectureSeq}:seq:${noticeSeq}`
      : buildFallbackNoticeKey(lectureSeq, title, author, postedAt);
    if (seen.has(noticeKey)) continue;
    seen.add(noticeKey);

    const isNew = node.find('.notice_new_icon, .new, .icon-new, img[alt*="new"], .badge-new').length > 0
      || node.parent().find('.notice_new_icon, .new').length > 0
      || /\bnew\b/i.test(lineText);

    const bodyText = normalizeNoticeText(
      parseNoticeBodyCandidates($, node, noticeSeq)
      || parseNoticeBodyCandidates($, node.closest('li, tr, .notice_item, .board_item').first(), noticeSeq),
    );

    notices.push({
      userId,
      lectureSeq,
      noticeKey,
      noticeSeq: noticeSeq ?? undefined,
      title,
      author,
      postedAt,
      bodyText,
      isNew,
      syncedAt,
    });
  }

  return notices;
}

export function parseNotificationListHtml(html: string, userId: string): NotificationEvent[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const events: NotificationEvent[] = [];
  const seen = new Set<string>();

  const itemCandidates = $(
    [
      'a.notification_content',
      'a.notice_content',
      '.notification_content',
      '.notification_item',
      '.alarm_content',
      '.notice_item',
      '.notification_list_item',
      'li[id*="noti"]',
      'li[id*="alarm"]',
    ].join(", "),
  ).toArray();

  const stripUnreadSuffix = (value: string): string =>
    normalizeNoticeText(value).replace(/\s*(미확인|읽지않음|not-read|not_checked|아직\s*읽지\s*않음)\s*$/i, "").trim();

  for (const rawItem of itemCandidates) {
    const item = $(rawItem);
    const lineText = normalizeNoticeText(item.text());
    if (!lineText) continue;

    const subjectText = normalizeNoticeText(
      item.find('.notification_subject, .notification_title, .subject, .course-title, .title').first().text(),
    ) || normalizeNoticeText(item.attr("data-course-title") ?? "");
    const subject = subjectText || normalizeNoticeText(lineText.split(/\n|\s{2,}/)[0]) || "공지";

    const fullText = normalizeNoticeText(item.text());
    const inlineText = normalizeNoticeText(
      item.find('.notification_text, .notification_body, .message, .noti_txt, .cont, .description').first().text(),
    );
    const attributeText = normalizeNoticeText(
      [
        item.attr("data-message"),
        item.attr("data-msg"),
        item.attr("data-content"),
        item.attr("title"),
        item.attr("aria-label"),
      ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join(" "),
    );

    const candidate = [inlineText, attributeText, fullText]
      .map((value) => stripUnreadSuffix(value))
      .filter((value) => value.length > 0)
      .sort((a, b) => b.length - a.length)[0] ?? "";
    const bracket = candidate.match(/^\s*\[(.*?)\]\s*(.*)$/);
    const messageBody = stripUnreadSuffix(bracket?.[2] || candidate);
    const withCategory = subject && messageBody.startsWith(subject)
      ? stripUnreadSuffix(messageBody.slice(subject.length))
      : messageBody;
    const category = normalizeNoticeText(
      bracket?.[1] || item.attr("data-category") || item.attr('class')?.match(/(\S*알림\S*|\S*공지\S*|notice[^\s]*)/)?.[1] || "알림",
    );
    const message = stripUnreadSuffix(withCategory) || "내용 없음";

    const rawTime =
      normalizeNoticeText(item.find('.notification_day, .notification-day, .time, .date, .notification_time').text())
      || normalizeNoticeText(fullText.match(/(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}(?:\s*(?:오전|오후|AM|PM)\s*\d{1,2}:\d{2}(?::\d{2})?)?)/)?.[1] ?? '');
    const occurredAt = toIsoDateTime(rawTime);

    const notifierSeq =
      item.attr('data-notifier-seq')
      ?? item.attr('data-notice-seq')
      ?? item.attr('data-notification-seq')
      ?? item.attr('href')?.match(/NOTIFIER_SEQ=(\d+)/)?.[1]
      ?? item.attr('href')?.match(/(?:A_SEQ|NOTICE_SEQ|notice_seq|artl_seq)=(\d+)/i)?.[1]
      ?? item.closest('a, li').attr('id')?.match(/(\d+)$/)?.[1]
      ?? String(
        Math.abs(
          `${subject}|${message}|${rawTime}`.split("").reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) | 0, 7),
        ),
      );

    if (seen.has(notifierSeq)) continue;
    seen.add(notifierSeq);

    events.push({
      userId,
      notifierSeq,
      courseTitle: subject,
      category,
      message,
      occurredAt,
      isCanceled: /취소|중단|동결|마감/.test(`${lineText} ${category}`),
      isUnread: /미확인|아직|읽지않음|not_checked|not-read/.test(`${lineText} ${fullText} ${rawTime}`),
      syncedAt,
    });
  }

  return events;
}

export function parseTodoVodTasks(html: string, userId: string, lectureSeq: number): LearningTask[] {
  const $ = load(html);
  const tasks: LearningTask[] = [];
  const activityTypeByCode: Record<string, LearningTask["activityType"]> = {
    C01: "VOD",
    C02: "ASSIGNMENT",
    C03: "QUIZ",
    C04: "ASSIGNMENT",
    C05: "QUIZ",
    C06: "ETC",
    C10: "ASSIGNMENT",
    C11: "QUIZ",
    C12: "ASSIGNMENT",
  };

  const candidates = $(
    [
      'a[href*="javascript:viewGo("]',
      'a[onclick*="viewGo("]',
      "a[href*='viewGo']",
      'a[href*="javascript:pageGo("]',
      'a[onclick*="pageGo("]',
      "a[href*='pageGo']",
      "a.todo_link",
      "a.view_go",
      ".todo_title",
      ".learning_task",
      ".class_todo",
      "[onclick*='viewGo']",
      "[onclick*='pageGo']",
      "tr[id*='todo_']",
    ].join(", "),
  );

  const pageText = normalizeWhitespace($.root().text());
  const weekWindowByWeekNo = new Map<number, { availableFrom: string | null; dueAt: string | null }>();
  const weekBlockPatterns = [
    /(?:^|\s)(\d{1,2})\s*주차([\s\S]*?)(?=(?:^|\s)\d{1,2}\s*주차|$)/g,
    /(?:^|\s)제?\s*(\d{1,2})\s*주([\s\S]*?)(?=(?:^|\s)제?\s*\d{1,2}\s*주|$)/g,
  ];

  for (const pattern of weekBlockPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(pageText)) !== null) {
      const parsedWeekNo = Number(match[1] ?? 0);
      if (!parsedWeekNo || weekWindowByWeekNo.has(parsedWeekNo)) continue;
      const blockText = normalizeWhitespace(`${match[1] ?? ""}주차 ${match[2] ?? ""}`);
      const blockWindow = parseTaskWindow(blockText);
      if (blockWindow && (blockWindow.availableFrom || blockWindow.dueAt)) {
        weekWindowByWeekNo.set(parsedWeekNo, blockWindow);
      }
    }
  }

  for (const el of candidates.toArray()) {
    const item = $(el);
    const raw = normalizeWhitespace(item.text());
    if (!raw) continue;

    const onclick = item.attr("onclick") ?? "";
    const href = item.attr("href") ?? "";
    const argsRaw = `${onclick} ${href}`;
    const viewGoMatch = argsRaw.match(
      /viewGo\(\s*['"]?([^\",\s]+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/, 
    );

    let activityCode = "";
    let courseContentsSeq = 0;
    let weekNo = 0;
    let lessonNo = 0;
    let pathHint = "";

    if (viewGoMatch) {
      activityCode = viewGoMatch[1]?.trim() ?? "";
      courseContentsSeq = Number(viewGoMatch[2]);
      weekNo = Number(viewGoMatch[3]);
      lessonNo = Number(viewGoMatch[4]);
    } else {
      const pageGoRaw =
        argsRaw.match(/pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? href.match(/^javascript:\s*pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? "";
      if (pageGoRaw) {
        const normalizedPageGoUrl = pageGoRaw.replace(/&amp;/gi, "&").trim();
        pathHint = normalizedPageGoUrl;

        try {
          const parsed = new URL(
            normalizedPageGoUrl.startsWith("http")
              ? normalizedPageGoUrl
              : `https://placeholder.local${normalizedPageGoUrl.startsWith("/") ? "" : "/"}${normalizedPageGoUrl}`,
          );
          courseContentsSeq = Number(parsed.searchParams.get("COURSE_CONTENTS_SEQ") ?? parsed.searchParams.get("contents_seq") ?? 0);
          weekNo = Number(parsed.searchParams.get("WEEK_NO") ?? parsed.searchParams.get("week_no") ?? 0);
          lessonNo = Number(parsed.searchParams.get("LESSNS_NO") ?? parsed.searchParams.get("lesson_no") ?? 0);
          pathHint = parsed.pathname;
        } catch {
          courseContentsSeq = Number(normalizedPageGoUrl.match(/[?&](?:COURSE_CONTENTS_SEQ|contents_seq)=(\d+)/i)?.[1] ?? 0);
          weekNo = Number(normalizedPageGoUrl.match(/[?&](?:WEEK_NO|week_no)=(\d+)/i)?.[1] ?? 0);
          lessonNo = Number(normalizedPageGoUrl.match(/[?&](?:LESSNS_NO|lesson_no)=(\d+)/i)?.[1] ?? 0);
        }
      }
    }

    if (!courseContentsSeq || !weekNo || !lessonNo) continue;

    const activityType =
      (activityCode ? activityTypeByCode[activityCode] : undefined)
      ?? (/contents_vod|온라인강의|동영상|vod/i.test(`${pathHint} ${raw}`) ? "VOD" : undefined)
      ?? (/contents_(?:quiz|test)|quiz|exam|기말시험|중간시험|시험|퀴즈/i.test(`${pathHint} ${raw}`) ? "QUIZ" : undefined)
      ?? (/contents_(?:survey|assignment|report|discussion|debate|board)|과제|설문|토론|리포트/i.test(`${pathHint} ${raw}`) ? "ASSIGNMENT" : undefined)
      ?? "ETC";

    const requiredLabel = raw.match(/(?:필수시간|학습인정시간|인정시간|소요시간|수강시간|제출시간)\s*[:\-]?\s*([^|\r\n]+)/)?.[1];
    const learnedLabel = raw.match(/(?:학습완료시간|수강완료시간|학습완료|완료시간|완료)\s*[:\-]?\s*([^|\r\n]+)/)?.[1];
    const requiredSeconds = parseDurationToSeconds(requiredLabel ?? "");
    const learnedSeconds = parseDurationToSeconds(learnedLabel ?? "");
    const taskTitle = raw.slice(0, 200);

    const candidateTexts = [
      raw,
      item.parent().text(),
      item.parent().siblings().text(),
      item.closest("tr").text(),
      item.closest("tr").prev().text(),
      item.closest("tr").next().text(),
      item.closest("li").text(),
      item.closest("td").text(),
      item.closest("div").text(),
      item.closest(".todo_item, .class_box, .contents_item, .class_contents, .lecture_cont").text(),
      item.closest(".study_design, .study_list, .contents_wrap, .week_cont, .week_box").text(),
      item.closest("[id*='week_'], [id*='chapter_'], [class*='week']").text(),
      item.closest("tr").find("td").slice(1).text(),
      item.closest(".todo_list").text(),
      item.closest(".todo").text(),
    ];

    const hasCompleteKeyword = /(학습완료|수강완료|제출완료|완료시간|done)/i.test(raw);
    const window =
      candidateTexts
        .map((text) => parseTaskWindow(text))
        .find((entry) => entry !== null && (entry.dueAt !== null || entry.availableFrom !== null))
      ?? weekWindowByWeekNo.get(weekNo)
      ?? null;

    tasks.push({
      userId,
      lectureSeq,
      courseContentsSeq,
      weekNo,
      lessonNo,
      taskTitle,
      activityType,
      requiredSeconds,
      learnedSeconds,
      state: hasCompleteKeyword || (learnedSeconds > 0 && requiredSeconds > 0 && learnedSeconds >= requiredSeconds) ? "COMPLETED" : "PENDING",
      availableFrom: window?.availableFrom ?? null,
      dueAt: window?.dueAt ?? null,
    });
  }

  return tasks;
}
