import { load } from "cheerio";
import type {
  CourseNotice,
  CourseState,
  LearningTask,
  NotificationEvent,
  PortalMessage,
} from "./types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toLectureSeq(rawKey: string): number {
  const digits = rawKey.replace(/\D+/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = normalizeWhitespace(raw);
  const match = cleaned.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function toIsoDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = normalizeWhitespace(
    raw
      .replace(/\uC624\uC804/g, "AM")
      .replace(/\uC624\uD6C4/g, "PM"),
  );
  const match = cleaned.match(
    /(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\s+(AM|PM))?(?:\s+(\d{1,2}):(\d{2}))?/i,
  );
  if (!match) return null;
  let hour = Number(match[5] ?? "0");
  if (match[4]?.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[4]?.toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${(match[6] ?? "00").padStart(2, "0")}:00+09:00`;
}

function toRelativeIsoDateTime(raw: string, fallbackDate: string | null): string | null {
  const cleaned = normalizeWhitespace(
    raw
      .replace(/\uC624\uC804/g, "AM")
      .replace(/\uC624\uD6C4/g, "PM"),
  );
  const now = new Date();

  const hoursAgo = Number(cleaned.match(/(\d+)\s*시간 전/)?.[1] ?? NaN);
  if (Number.isFinite(hoursAgo)) {
    return new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000)).toISOString();
  }

  const minutesAgo = Number(cleaned.match(/(\d+)\s*분 전/)?.[1] ?? NaN);
  if (Number.isFinite(minutesAgo)) {
    return new Date(now.getTime() - (minutesAgo * 60 * 1000)).toISOString();
  }

  if (cleaned.includes("어제")) {
    const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const timeMatch = cleaned.match(/(AM|PM)\s+(\d{1,2}):(\d{2})/i);
    let hour = Number(timeMatch?.[2] ?? "0");
    if (timeMatch?.[1]?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (timeMatch?.[1]?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${timeMatch?.[3] ?? "00"}:00+09:00`;
  }

  if (fallbackDate) {
    const timeMatch = cleaned.match(/(AM|PM)\s+(\d{1,2}):(\d{2})/i);
    if (timeMatch) {
      let hour = Number(timeMatch[2]);
      if (timeMatch[1].toUpperCase() === "PM" && hour < 12) hour += 12;
      if (timeMatch[1].toUpperCase() === "AM" && hour === 12) hour = 0;
      return `${fallbackDate}T${String(hour).padStart(2, "0")}:${timeMatch[3]}:00+09:00`;
    }

    return `${fallbackDate}T00:00:00+09:00`;
  }

  return null;
}

function extractWeekAndLesson(title: string, fallbackLessonNo: number): { weekNo: number; lessonNo: number } {
  const normalized = normalizeWhitespace(title);
  const weekNo = Number(normalized.match(/(\d+)\s*(?:주차|주)/)?.[1] ?? normalized.match(/(\d+)장/)?.[1] ?? 0);
  const lessonNo = Number(normalized.match(/(\d+)\s*차시/)?.[1] ?? fallbackLessonNo);
  return {
    weekNo: weekNo > 0 ? weekNo : Math.max(1, fallbackLessonNo),
    lessonNo: lessonNo > 0 ? lessonNo : Math.max(1, fallbackLessonNo),
  };
}

function normalizeTaskTitle(raw: string): string {
  return normalizeWhitespace(raw).replace(/^\[[^\]]+\]\s*/, "");
}

function buildCommunityNoticeKey(rawNoticeId: string, title: string): string {
  return rawNoticeId ? `community:${rawNoticeId}` : `community:${title.toLowerCase()}`;
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
    const rawKey = normalizeWhitespace(node.attr("kj") ?? node.attr("onclick")?.match(/eclassRoom\('([^']+)'\)/)?.[1] ?? "");
    const lectureSeq = toLectureSeq(rawKey);
    if (!rawKey || lectureSeq <= 0 || seen.has(lectureSeq)) return;
    seen.add(lectureSeq);

    const text = normalizeWhitespace(node.text()).replace(/\(\d{3,}-\d+\)\s*$/, "").trim();
    const title = text || `Course ${lectureSeq}`;

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
    const postedAt = toIsoDate(node.closest("li").find(".date").first().text());

    items.push({
      userId,
      lectureSeq: 0,
      externalLectureId: "community",
      noticeKey: buildCommunityNoticeKey(rawNoticeId, title),
      noticeSeq: rawNoticeId || undefined,
      title,
      author: null,
      postedAt,
      bodyText: "",
      isNew: false,
      syncedAt,
    });
  });

  return items;
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
      const occurredAt = toRelativeIsoDateTime(rawTime, toIsoDate(currentDate));

      items.push({
        userId,
        notifierSeq,
        courseTitle,
        category,
        message,
        occurredAt,
        isCanceled: /취소|중단|마감/.test(message),
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
    const { weekNo, lessonNo } = extractWeekAndLesson(taskTitle || rawTitle, courseContentsSeq);

    let activityType: LearningTask["activityType"] = "ETC";
    if (/온라인강의/.test(rawTitle) || gubun === "lecture_weeks") {
      activityType = "VOD";
    } else if (/시험/.test(rawTitle) || gubun === "test") {
      activityType = "QUIZ";
    } else if (/과제|프로젝트|토론/.test(rawTitle) || ["report", "project", "discuss"].includes(gubun)) {
      activityType = "ASSIGNMENT";
    }

    tasks.push({
      userId,
      lectureSeq,
      externalLectureId: rawLectureId,
      courseContentsSeq,
      weekNo,
      lessonNo,
      taskTitle,
      activityType,
      requiredSeconds: 0,
      learnedSeconds: 0,
      state: "PENDING",
      availableFrom: null,
      dueAt: toIsoDateTime(dueText),
    });
  });

  return tasks;
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

    const messageSeq = match[1];
    const senderId = match[2];
    const title = normalizeWhitespace(node.text());
    const senderName = normalizeWhitespace(title.match(/-(.+?)님\s*이 보냈습니다\./)?.[1] ?? "") || null;

    items.push({
      userId,
      messageSeq,
      title,
      senderId,
      senderName,
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
  const currentYear = String(new Date().getFullYear());

  const title = normalizeWhitespace(rows.eq(0).find("td").text());
  const senderName = normalizeWhitespace(rows.eq(1).find("td").text()) || null;
  const sentAt = toIsoDateTime(`${currentYear}.${normalizeWhitespace(rows.eq(2).find("td").text())}`);
  const bodyText = normalizeWhitespace(rows.eq(3).find(".textviewer, td").text());

  return {
    title,
    senderName,
    bodyText,
    sentAt,
  };
}
