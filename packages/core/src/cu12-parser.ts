import { load } from "cheerio";
import type { CourseNotice, CourseState, LearningTask, NotificationEvent } from "./types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\([^)]*\)/g, "").trim();
  const match = cleaned.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toIsoDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\([^)]*\)/g, "").trim();
  const match = cleaned.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`;
}

function parseDurationToSeconds(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = raw.match(/(\d+)\s*분(?:\s*(\d+)\s*초)?/);
  if (!m) return 0;
  const minutes = Number(m[1] ?? 0);
  const seconds = Number(m[2] ?? 0);
  return minutes * 60 + seconds;
}

export function parseMyCourseHtml(html: string, userId: string, status: CourseState["status"] = "ACTIVE"): CourseState[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const seen = new Set<number>();
  const items: CourseState[] = [];

  $('a[href^="javascript:enterClass("]')
    .filter((_, el) => normalizeWhitespace($(el).text()).includes("강의실로 이동"))
    .each((_, el) => {
      const link = $(el);
      const href = link.attr("href") ?? "";
      const lectureSeqMatch = href.match(/enterClass\((\d+)\)/);
      const lectureSeq = Number(lectureSeqMatch?.[1] ?? 0);

      if (!lectureSeq || seen.has(lectureSeq)) {
        return;
      }
      seen.add(lectureSeq);

      let card = link.parent();
      while (card.length > 0) {
        const text = normalizeWhitespace(card.text());
        if (/진도율\s*\d+%/.test(text) && /학습기간/.test(text)) {
          break;
        }
        card = card.parent();
      }
      const cardText = normalizeWhitespace(card.text());

      const title = normalizeWhitespace(link.text()).replace(/\s*강의실로 이동$/, "");
      const instructor = normalizeWhitespace(card.find('a[href^="javascript:goProfile("]').first().text()) || null;
      const progressPercent = Number(cardText.match(/진도율\s*(\d+)%/)?.[1] ?? 0);
      const remainDays = Number(cardText.match(/남은기간\s*(\d+)일/)?.[1] ?? Number.NaN);
      const recentLearnedAt = toIsoDate(cardText.match(/최근학습\s*(없음|\d{4}\.\d{2}\.\d{2}\s*\([^)]*\))/)?.[1]);

      const periodRange = cardText.match(/(\d{4}\.\d{2}\.\d{2}\s*\([^)]*\)\s*~\s*\d{4}\.\d{2}\.\d{2}\s*\([^)]*\))/)?.[1] ?? null;
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

export function parseNoticeListHtml(html: string, userId: string, lectureSeq: number): CourseNotice[] {
  const $ = load(html);
  const syncedAt = new Date().toISOString();
  const notices: CourseNotice[] = [];

  const primaryCandidates = $('button.notice_title[id^="notice_tit_"]').toArray();
  const fallbackCandidates = $("button, a")
    .filter((_, el) => /공지사항제목|공지\s*제목/.test(normalizeWhitespace($(el).text())))
    .toArray();
  const candidates = primaryCandidates.length > 0 ? primaryCandidates : fallbackCandidates;

  for (const [index, el] of candidates.entries()) {
    const node = $(el);
    const lineText = normalizeWhitespace(node.text());
    const noticeSeq =
      node.attr("id")?.match(/notice_tit_(\d+)/)?.[1]
      ?? node.attr("onclick")?.match(/noticeShow\('\d+',\s*'(\d+)'\)/)?.[1]
      ?? null;

    const title = normalizeWhitespace(node.find(".class_notice_title_sub").first().text())
      || lineText.match(/공지사항제목\s*(.*?)\s*등록일/)?.[1]?.trim()
      || lineText.match(/공지\s*제목\s*(.*?)\s*등록일/)?.[1]?.trim()
      || `notice-${index + 1}`;

    const postedRaw =
      node
        .find(".class_notice_date")
        .toArray()
        .map((item) => normalizeWhitespace($(item).text()))
        .find((text) => text.startsWith("등록일"))
      ?? lineText.match(/등록일\s*(\d{4}\.\d{2}\.\d{2})/)?.[0]
      ?? "";
    const postedAt = toIsoDate(postedRaw.match(/(\d{4}\.\d{2}\.\d{2})/)?.[1]);

    const authorRaw =
      node
        .find(".class_notice_date")
        .toArray()
        .map((item) => normalizeWhitespace($(item).text()))
        .find((text) => text.startsWith("등록자"))
      ?? lineText.match(/등록자\s*[^\s]+/)?.[0]
      ?? "";
    const author = authorRaw.match(/등록자\s*(.+)$/)?.[1]?.trim() ?? null;

    const isNew = node.find(".notice_new_icon, img[alt*='새']").length > 0 || /새\s*글|새글/.test(lineText);

    const nearbyContainer =
      node.closest("li, tr, .board_item, .notice_item, .accordion_item, .card").first();
    const bodyCandidates: Array<{ text: () => string }> = [
      node.next(),
      node.parent().next(),
      nearbyContainer.find(".view_cont, .notice_cont, .cont, .content, .txt").first(),
    ];

    const controlTarget = node.attr("aria-controls")
      ?? node.attr("data-target")
      ?? node.attr("href")?.match(/#([A-Za-z0-9_-]+)/)?.[1]
      ?? (noticeSeq ? `notice_txt_${noticeSeq}` : undefined);
    if (controlTarget) {
      bodyCandidates.push($(`#${controlTarget.replace(/^#/, "")}`));
    }

    const cleanedBody = bodyCandidates
      .map((item) => normalizeWhitespace((item?.text() ?? "").replace(/^공지내용/, "")))
      .find((text) => text.length > 0 && text !== lineText)
      ?? "";

    const bodyText = cleanedBody.length > 0
      ? cleanedBody
      : normalizeWhitespace(
        nearbyContainer
          .text()
          .replace(lineText, "")
          .replace(/^공지내용/, ""),
      );

    const noticeKey = noticeSeq
      ? `${lectureSeq}:seq:${noticeSeq}`
      : `${lectureSeq}:${postedAt ?? "undated"}:${title}`;

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

  $("a.notification_content").each((_, el) => {
    const item = $(el);
    const href = item.attr("href") ?? "";
    const notifierSeq = href.match(/NOTIFIER_SEQ=(\d+)/)?.[1] ?? "";
    const text = normalizeWhitespace(item.text());

    const heading = item.closest("div").prevAll(".notification_title").first().text();
    const occurredAt = toIsoDate(heading);

    const category = text.match(/\[(.*?)\]/)?.[1] ?? "SYSTEM";
    const courseTitle = text.match(/^(.*?)\s*\[(.*?)\]/)?.[1]?.trim() ?? text.split(" ")[0] ?? "";

    events.push({
      userId,
      notifierSeq,
      courseTitle,
      category,
      message: text,
      occurredAt,
      isCanceled: /취소된\s*알림/.test(text),
      isUnread: /아직$/.test(text),
      syncedAt,
    });
  });

  return events;
}

export function parseTodoVodTasks(html: string, userId: string, lectureSeq: number): LearningTask[] {
  const $ = load(html);
  const tasks: LearningTask[] = [];

  $('a[href^="javascript:viewGo(\'C01\'"]').each((_, el) => {
    const item = $(el);
    const href = item.attr("href") ?? "";
    const match = href.match(/viewGo\('C01',\s*'(\d+)',\s*'(\d+)',\s*'(\d+)'/);
    if (!match) return;

    const courseContentsSeq = Number(match[1]);
    const weekNo = Number(match[2]);
    const lessonNo = Number(match[3]);
    const raw = normalizeWhitespace(item.text());

    const requiredSeconds = parseDurationToSeconds(raw.match(/인정시간\s*:\s*(\d+분\s*\d*초?)/)?.[1]);
    const learnedSeconds = parseDurationToSeconds(raw.match(/학습시간\s*:\s*(\d+분\s*\d*초?)/)?.[1]);
    const completed = /완료됨|활동이 완료/.test(raw);
    const periodMatch = raw.match(
      /학습인정기간\s*:\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/,
    );
    const availableFrom = toIsoDateTime(periodMatch?.[1]);
    const dueAt = toIsoDateTime(periodMatch?.[2]);

    tasks.push({
      userId,
      lectureSeq,
      courseContentsSeq,
      weekNo,
      lessonNo,
      activityType: "VOD",
      requiredSeconds,
      learnedSeconds,
      state: completed ? "COMPLETED" : "PENDING",
      availableFrom,
      dueAt,
    });
  });

  return tasks;
}

