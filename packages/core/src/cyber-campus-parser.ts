import { load } from "cheerio";
import type {
  CourseNotice,
  CourseState,
  LearningTask,
  NotificationEvent,
  PortalMessage,
} from "./types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDateText(raw: string | null | undefined): string {
  return normalizeWhitespace(raw ?? "")
    .replace(/오전/gi, "AM")
    .replace(/오후/gi, "PM")
    .replace(/정오/gi, "PM")
    .replace(/자정/gi, "AM");
}

const MAX_INT32 = 2147483647n;

function toStableInt32(raw: string): number {
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = Math.imul(hash, 31) + raw.charCodeAt(index);
    hash |= 0;
  }

  const normalized = (hash >>> 0) % Number(MAX_INT32);
  return normalized === 0 ? 1 : normalized;
}

function toLectureSeq(rawKey: string): number {
  const digits = rawKey.replace(/\D+/g, "");
  if (!digits) return 0;

  try {
    const parsed = BigInt(digits);
    if (parsed <= 0n) return 0;
    if (parsed <= MAX_INT32) {
      return Number(parsed);
    }
    return toStableInt32(digits);
  } catch {
    return 0;
  }
}

function toIsoDate(raw: string | null | undefined): string | null {
  const cleaned = normalizeDateText(raw).replace(/\([^)]*\)/g, "");
  const match = cleaned.match(/(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})/);
  if (!match) return null;

  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function toIsoDateTime(raw: string | null | undefined): string | null {
  const cleaned = normalizeDateText(raw).replace(/\([^)]*\)/g, "");
  const dateMatch = cleaned.match(
    /(\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})(?:\s*(AM|PM))?(?:\s+(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?)?/i,
  );
  if (!dateMatch) return null;

  const year = dateMatch[1];
  const month = dateMatch[2].padStart(2, "0");
  const day = dateMatch[3].padStart(2, "0");
  const period = (dateMatch[4] ?? "").toUpperCase();
  const rawHour = Number(dateMatch[5]);
  if (!Number.isFinite(rawHour)) {
    return `${year}-${month}-${day}T00:00:00+09:00`;
  }

  let hour = rawHour;
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;

  const minute = (dateMatch[6] ?? "00").padStart(2, "0");
  const second = (dateMatch[7] ?? "00").padStart(2, "0");
  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}:${second}+09:00`;
}

function parseClockToSeconds(
  raw: string | null | undefined,
  options?: {
    twoPartStyle?: "minutes:seconds" | "hours:minutes";
  },
): number {
  const cleaned = normalizeWhitespace(raw ?? "");
  const clockMatch = cleaned.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!clockMatch) return 0;

  if (clockMatch[3]) {
    return (Number(clockMatch[1]) * 3600) + (Number(clockMatch[2]) * 60) + Number(clockMatch[3]);
  }

  if (options?.twoPartStyle === "hours:minutes") {
    return (Number(clockMatch[1]) * 3600) + (Number(clockMatch[2]) * 60);
  }

  return (Number(clockMatch[1]) * 60) + Number(clockMatch[2]);
}

function parseDurationToSeconds(raw: string | null | undefined): number {
  const cleaned = normalizeWhitespace(raw ?? "");
  if (!cleaned) return 0;

  const hours = Number(cleaned.match(/(\d+)\s*시간/)?.[1] ?? 0);
  const minutes = Number(cleaned.match(/(\d+)\s*분/)?.[1] ?? 0);
  const seconds = Number(cleaned.match(/(\d+)\s*초/)?.[1] ?? 0);
  if (hours > 0 || minutes > 0 || seconds > 0) {
    return (hours * 3600) + (minutes * 60) + seconds;
  }

  return parseClockToSeconds(cleaned, { twoPartStyle: "hours:minutes" });
}

function parseProgressPair(raw: string): { learnedSeconds: number; requiredSeconds: number } {
  const match = normalizeWhitespace(raw).match(
    /(\d{1,3}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,3}:\d{2}(?::\d{2})?)/,
  );
  if (!match) {
    return { learnedSeconds: 0, requiredSeconds: 0 };
  }

  return {
    learnedSeconds: parseClockToSeconds(match[1], { twoPartStyle: "minutes:seconds" }),
    requiredSeconds: parseClockToSeconds(match[2], { twoPartStyle: "minutes:seconds" }),
  };
}

function extractDateTimeCandidates(raw: string): string[] {
  const normalized = normalizeDateText(raw);
  const pattern = /(\d{4}[./-]\s*\d{1,2}[./-]\s*\d{1,2}(?:\s*(?:AM|PM))?(?:\s+\d{1,2}(?::\d{2})(?::\d{2})?)?)/g;
  const candidates: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const candidate = normalizeWhitespace(match[1]);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }

  return candidates;
}

function parseDateRange(raw: string | null | undefined): { availableFrom: string | null; dueAt: string | null } {
  const candidates = extractDateTimeCandidates(raw ?? "");
  if (candidates.length >= 2) {
    return {
      availableFrom: toIsoDateTime(candidates[0]),
      dueAt: toIsoDateTime(candidates[1]),
    };
  }

  if (candidates.length === 1) {
    return {
      availableFrom: null,
      dueAt: toIsoDateTime(candidates[0]),
    };
  }

  return {
    availableFrom: null,
    dueAt: null,
  };
}

function toRelativeIsoDateTime(raw: string, fallbackDate: string | null): string | null {
  const cleaned = normalizeDateText(raw);
  const timeMatch = cleaned.match(/(AM|PM)\s+(\d{1,2}):(\d{2})/i);

  if (fallbackDate) {
    if (!timeMatch) {
      return `${fallbackDate}T00:00:00+09:00`;
    }

    let hour = Number(timeMatch[2]);
    if (timeMatch[1].toUpperCase() === "PM" && hour < 12) hour += 12;
    if (timeMatch[1].toUpperCase() === "AM" && hour === 12) hour = 0;
    return `${fallbackDate}T${String(hour).padStart(2, "0")}:${timeMatch[3]}:00+09:00`;
  }

  const now = new Date();
  const hoursAgo = Number(cleaned.match(/(\d+)\s*시간\s*전/)?.[1] ?? Number.NaN);
  if (Number.isFinite(hoursAgo)) {
    return new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000)).toISOString();
  }

  const minutesAgo = Number(cleaned.match(/(\d+)\s*분\s*전/)?.[1] ?? Number.NaN);
  if (Number.isFinite(minutesAgo)) {
    return new Date(now.getTime() - (minutesAgo * 60 * 1000)).toISOString();
  }

  if (/어제/.test(cleaned)) {
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    let hour = Number(timeMatch?.[2] ?? "0");
    if (timeMatch?.[1]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (timeMatch?.[1]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${timeMatch?.[3] ?? "00"}:00+09:00`;
  }

  return null;
}

function extractWeekNo(raw: string | null | undefined): number {
  const cleaned = normalizeWhitespace(raw ?? "");
  return Number(cleaned.match(/(\d+)\s*주(?:차)?/)?.[1] ?? 0);
}

function extractLessonNo(raw: string | null | undefined): number {
  const cleaned = normalizeWhitespace(raw ?? "");
  return Number(cleaned.match(/(\d+)\s*(?:차시|회차)/)?.[1] ?? 0);
}

function normalizeTaskTitle(raw: string): string {
  return normalizeWhitespace(raw).replace(/^\[[^\]]+\]\s*/, "");
}

function detectTaskActivityType(rawTitle: string, gubun: string): LearningTask["activityType"] {
  if (gubun === "lecture_weeks" || /온라인\s*강의|동영상/.test(rawTitle)) {
    return "VOD";
  }
  if (gubun === "test" || /시험|퀴즈/.test(rawTitle)) {
    return "QUIZ";
  }
  if (gubun === "material" || /강의자료|수업자료|교안/.test(rawTitle)) {
    return "MATERIAL";
  }
  if (["report", "project", "discuss"].includes(gubun) || /과제|프로젝트|토론/.test(rawTitle)) {
    return "ASSIGNMENT";
  }
  return "ETC";
}

function buildCommunityNoticeKey(rawNoticeId: string, title: string): string {
  return rawNoticeId ? `community:${rawNoticeId}` : `community:${title.toLowerCase()}`;
}

function pickLongestText(values: Array<string | null | undefined>): string {
  return values
    .map((value) => normalizeWhitespace(value ?? ""))
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

function parseMessageSenderName(title: string): string | null {
  const cleaned = normalizeWhitespace(title);
  const matched = cleaned.match(/-([^-]+?)님\s+이\s+보냈습니다\.?$/);
  return normalizeWhitespace(matched?.[1] ?? "") || null;
}

function isCanceledNotification(message: string): boolean {
  const cleaned = normalizeWhitespace(message);
  if (!cleaned) return false;
  return /취소|중단|종료|휴강|삭제/.test(cleaned);
}

export function parseCyberCampusMainCoursesHtml(
  html: string,
  userId: string,
  status: CourseState["status"] = "ACTIVE",
): CourseState[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const seen = new Set<number>();
  const items: CourseState[] = [];

  $("em.sub_open[kj], em.sub_open[onclick*='eclassRoom']").each((_, el) => {
    const node = $(el);
    const rawKey = normalizeWhitespace(
      node.attr("kj")
      ?? node.attr("onclick")?.match(/eclassRoom\('([^']+)'\)/)?.[1]
      ?? "",
    );
    const lectureSeq = toLectureSeq(rawKey);
    if (!rawKey || lectureSeq <= 0 || seen.has(lectureSeq)) return;
    seen.add(lectureSeq);

    const title = normalizeWhitespace(node.text()).replace(/\(\d{3,}-\d+\)\s*$/, "").trim() || `Course ${lectureSeq}`;

    items.push({
      userId,
      lectureSeq,
      externalLectureId: rawKey,
      title,
      instructor: null,
      progressPercent: 0,
      remainDays: null,
      recentLearnedAt: null,
      periodStart: null,
      periodEnd: null,
      status,
      syncedAt,
    });
  });

  return items;
}

export function parseCyberCampusCommunityNoticeListHtml(html: string, userId: string): CourseNotice[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const items: CourseNotice[] = [];

  $(".m-box2 a[href*='/ilos/community/notice_view_form.acl?ARTL_NUM=']").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") ?? "";
    const rawNoticeId = href.match(/ARTL_NUM=(\d+)/)?.[1] ?? "";
    const title = normalizeWhitespace(node.text());
    if (!title) return;

    items.push({
      userId,
      lectureSeq: 0,
      externalLectureId: "community",
      noticeKey: buildCommunityNoticeKey(rawNoticeId, title),
      noticeSeq: rawNoticeId || undefined,
      title,
      author: null,
      postedAt: toIsoDate(node.closest("li").find(".date").first().text()),
      bodyText: "",
      isNew: false,
      syncedAt,
    });
  });

  return items;
}

export function parseCyberCampusCommunityNoticeDetailHtml(
  html: string,
): Pick<CourseNotice, "author" | "postedAt" | "bodyText"> {
  const $ = load(html);
  const metaText = normalizeWhitespace(
    [
      $(".artl_title_form").first().text(),
      $(".artl_reg_info").first().text(),
      $(".artl_form").first().text(),
    ].join(" "),
  );

  const bodyText = pickLongestText([
    $(".textviewer").first().text(),
    $(".artl_content_form .textviewer").first().text(),
    $(".artl_content_form").first().text(),
    $(".view_cont").first().text(),
    $(".notice_content").first().text(),
  ]);

  return {
    author: normalizeWhitespace(
      metaText.match(/(?:작성자|등록자)\s*[:：]?\s*([^\d|]+?)(?=(?:등록일|작성일|조회|$))/)?.[1]
      ?? $(".artl_reg_info .writer, .artl_reg_info .author").first().text(),
    ) || null,
    postedAt: toIsoDate(metaText),
    bodyText,
  };
}

export function parseCyberCampusNotificationListHtml(html: string, userId: string): NotificationEvent[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const items: NotificationEvent[] = [];
  let currentDate = "";

  $("body")
    .find(".notification_title, .notification_content")
    .each((_, el) => {
      const node = $(el);
      if (node.hasClass("notification_title")) {
        currentDate = normalizeWhitespace(node.text());
        return;
      }

      const onclick = node.attr("onclick") ?? "";
      const notifierSeq =
        onclick.match(/goSubjectPage\(\s*'[^']+'\s*,\s*'([^']+)'/)?.[1]
        ?? onclick.match(/goCommunityPage\(\s*'([^']+)'/)?.[1]
        ?? `${items.length + 1}`;
      const courseTitle = normalizeWhitespace(node.find(".notification_subject").first().text()) || "알림";
      const text = normalizeWhitespace(node.find(".notification_text").first().text());
      const category = normalizeWhitespace(text.match(/^\[([^\]]+)\]/)?.[1] ?? "알림");
      const message = normalizeWhitespace(text.replace(/^\[[^\]]+\]\s*/, "")) || text || "내용 없음";
      const rawTime = normalizeWhitespace(node.find(".notification_day span").first().text());

      items.push({
        userId,
        notifierSeq,
        courseTitle,
        category,
        message,
        occurredAt: toRelativeIsoDateTime(rawTime, toIsoDate(currentDate)),
        isCanceled: isCanceledNotification(message),
        isUnread: true,
        syncedAt,
      });
    });

  return items;
}

export function parseCyberCampusTodoListHtml(html: string, userId: string): LearningTask[] {
  const $ = load(html);
  const tasks: LearningTask[] = [];

  $(".todo_wrap").each((_, el) => {
    const node = $(el);
    const onclick = node.attr("onclick") ?? "";
    const match = onclick.match(/goLecture\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
    if (!match) return;

    const rawLectureId = match[1];
    const lectureSeq = toLectureSeq(rawLectureId);
    const courseContentsSeq = Number(match[2] ?? "0");
    const gubun = match[3] ?? "";
    if (lectureSeq <= 0 || !Number.isFinite(courseContentsSeq) || courseContentsSeq <= 0) return;

    const rawTitle = normalizeWhitespace(node.find(".todo_title").first().text());
    const taskTitle = normalizeTaskTitle(rawTitle);
    const dueText = normalizeWhitespace(node.find(".todo_date .todo_date").last().text());
    const weekNo = extractWeekNo(taskTitle || rawTitle);
    const lessonNo = extractLessonNo(taskTitle || rawTitle) || courseContentsSeq;

    tasks.push({
      userId,
      lectureSeq,
      externalLectureId: rawLectureId,
      courseContentsSeq,
      weekNo,
      lessonNo,
      taskTitle,
      activityType: detectTaskActivityType(rawTitle, gubun),
      requiredSeconds: 0,
      learnedSeconds: 0,
      state: "PENDING",
      availableFrom: null,
      dueAt: toIsoDateTime(dueText),
    });
  });

  return tasks;
}

export function parseCyberCampusOnlineWeekDetailHtml(
  html: string,
  userId: string,
  externalLectureId: string,
): { tasks: LearningTask[]; progressPercent: number } {
  const $ = load(html);
  const lectureSeq = toLectureSeq(externalLectureId);
  const tasks: LearningTask[] = [];
  const seenWeeks = new Map<number, { completedCount: number; totalCount: number }>();

  $("[id^='week-'], .wb").each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    const match = text.match(/(\d+)\s*주\s*(\d+)\s*\/\s*(\d+)/);
    if (!match) return;
    const weekNo = Number(match[1]);
    if (weekNo <= 0 || seenWeeks.has(weekNo)) return;

    seenWeeks.set(weekNo, {
      completedCount: Number(match[2]),
      totalCount: Number(match[3]),
    });
  });

  const progressCompleted = Array.from(seenWeeks.values()).reduce((sum, item) => sum + item.completedCount, 0);
  const progressTotal = Array.from(seenWeeks.values()).reduce((sum, item) => sum + item.totalCount, 0);
  const progressPercent = progressTotal > 0 ? Math.round((progressCompleted / progressTotal) * 100) : 0;

  const seenTaskSeqs = new Set<number>();
  $("[id^='lecture-']").each((_, el) => {
    const node = $(el);
    const htmlText = node.html() ?? "";
    const viewGoMatch = htmlText.match(/viewGo\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,/);
    const courseContentsSeq = Number(
      viewGoMatch?.[2]
      ?? node.attr("id")?.match(/lecture-(\d+)/)?.[1]
      ?? 0,
    );
    if (!Number.isFinite(courseContentsSeq) || courseContentsSeq <= 0 || seenTaskSeqs.has(courseContentsSeq)) {
      return;
    }
    seenTaskSeqs.add(courseContentsSeq);

    const title = normalizeWhitespace(node.find("li").first().text());
    const rowText = normalizeWhitespace(node.text());
    const windowMatch = rowText.match(/출석인정기간\s*:\s*([\s\S]+?)(?=출석부 반영일|학습내역|$)/);
    const duration = parseProgressPair(rowText);

    tasks.push({
      userId,
      lectureSeq,
      externalLectureId,
      courseContentsSeq,
      weekNo: Number(viewGoMatch?.[1] ?? extractWeekNo(title) ?? 0),
      lessonNo: extractLessonNo(title),
      taskTitle: title,
      activityType: "VOD",
      requiredSeconds: duration.requiredSeconds,
      learnedSeconds: duration.learnedSeconds,
      state: duration.requiredSeconds > 0 && duration.learnedSeconds >= duration.requiredSeconds ? "COMPLETED" : "PENDING",
      availableFrom: parseDateRange(windowMatch?.[1]).availableFrom,
      dueAt: parseDateRange(windowMatch?.[1]).dueAt,
    });
  });

  return {
    tasks,
    progressPercent,
  };
}

export function parseCyberCampusExamDetailHtml(
  html: string,
  userId: string,
  externalLectureId: string,
  courseContentsSeq: number,
): LearningTask | null {
  const $ = load(html);
  const table = $("table.bbsview, table").first();
  if (!table.length) return null;

  const rows = new Map<string, string>();
  table.find("tr").each((_, el) => {
    const label = normalizeWhitespace($(el).find("th").first().text());
    const value = normalizeWhitespace($(el).find("td").first().text());
    if (label) {
      rows.set(label, value);
    }
  });

  const title = rows.get("제목") ?? "";
  const weekNo = extractWeekNo(rows.get("주차"));
  if (!title && weekNo <= 0) return null;

  return {
    userId,
    lectureSeq: toLectureSeq(externalLectureId),
    externalLectureId,
    courseContentsSeq,
    weekNo,
    lessonNo: extractLessonNo(title),
    taskTitle: title,
    activityType: "QUIZ",
    requiredSeconds: parseDurationToSeconds(rows.get("시험시간")),
    learnedSeconds: 0,
    state: "PENDING",
    availableFrom: toIsoDateTime(rows.get("시작시간")),
    dueAt: toIsoDateTime(rows.get("종료시간")),
  };
}

export function parseCyberCampusMessageListHtml(html: string, userId: string): PortalMessage[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const items: PortalMessage[] = [];

  $("a[href^='javascript:viewPage(']").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") ?? "";
    const match = href.match(/viewPage\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
    if (!match) return;

    const title = normalizeWhitespace(node.text());
    items.push({
      userId,
      messageSeq: match[1],
      title,
      senderId: match[2],
      senderName: parseMessageSenderName(title),
      bodyText: "",
      sentAt: null,
      isRead: false,
      syncedAt,
    });
  });

  return items;
}

export function parseCyberCampusMessageDetailHtml(
  html: string,
): Pick<PortalMessage, "title" | "senderName" | "bodyText" | "sentAt"> {
  const $ = load(html);
  const table = $("table.bbsview").first();
  const rows = table.find("tr");
  const byLabel = new Map<string, string>();

  rows.each((_, el) => {
    const label = normalizeWhitespace($(el).find("th").first().text());
    const value = normalizeWhitespace($(el).find("td").first().text());
    if (label || value) {
      byLabel.set(label, value);
    }
  });

  const rawSentAt = byLabel.get("보낸시간") ?? normalizeWhitespace(rows.eq(2).find("td").text());
  const sentAt = /^\d{1,2}[./-]\d{1,2}/.test(rawSentAt)
    ? toIsoDateTime(`${new Date().getFullYear()}.${rawSentAt}`)
    : toIsoDateTime(rawSentAt);
  const bodyRow = rows.toArray().find((row) =>
    normalizeWhitespace($(row).find("th").first().text()).length === 0
    && normalizeWhitespace($(row).find("td").first().text()).length > 0);

  return {
    title: byLabel.get("제목") ?? normalizeWhitespace(rows.eq(0).find("td").text()),
    senderName: byLabel.get("보낸사람") ?? (normalizeWhitespace(rows.eq(1).find("td").text()) || null),
    bodyText: normalizeWhitespace($(bodyRow ?? rows.eq(3)).find(".textviewer, td").first().text()),
    sentAt,
  };
}
