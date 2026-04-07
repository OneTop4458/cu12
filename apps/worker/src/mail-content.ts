import {
  cleanupNoticeBody,
  cleanupNotificationMessage,
  hasConfidentNoticeBody,
  hasConfidentNotificationMessage,
} from "@cu12/core";
import type { AutoLearnMode, AutoLearnPlannedTask } from "./cu12-automation";

export const DASHBOARD_SECTION_ID = {
  OVERVIEW: "overview",
  NOTIFICATIONS: "notifications",
  DEADLINES: "deadlines",
  JOBS: "jobs",
  COURSES: "courses",
} as const;

type Link = { href: string; label: string };
type SummaryRow = { label: string; value: string };

export interface SyncAlertNoticeMailItem {
  title: string;
  author: string | null;
  postedAt: string | null;
  bodyText: string;
  courseTitle: string;
}

export interface SyncAlertNotificationMailItem {
  courseTitle: string;
  category: string;
  message: string;
  occurredAt: string | null;
  isCanceled?: boolean;
}

export interface DeadlineMailItem {
  courseTitle: string;
  weekNo: number;
  lessonNo: number;
  dueAt: Date | string;
  daysLeft: number;
}

export interface DigestNoticeMailItem {
  title: string;
  author: string | null;
  postedAt: Date | string | null;
  createdAt?: Date | string | null;
  bodyText: string;
  courseTitle: string;
}

export interface DigestNotificationMailItem {
  courseTitle: string;
  category: string;
  message: string;
  occurredAt: Date | string | null;
  createdAt?: Date | string | null;
  isUnread: boolean;
  isCanceled?: boolean;
}

export interface DigestDeadlineMailItem {
  lectureSeq: number;
  courseTitle: string;
  weekNo: number;
  lessonNo: number;
  dueAt: Date | string | null;
}

export interface MailDocument {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeInlineText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function isPresent(value: string | null | undefined): boolean {
  return normalizeInlineText(value).length > 0;
}

function toSnippet(value: string, maxLength = 140): string {
  const normalized = normalizeInlineText(value);
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function toNoticeSnippet(value: string | null | undefined, maxLength = 160): string | null {
  const cleaned = cleanupNoticeBody(value ?? "");
  if (!hasConfidentNoticeBody(cleaned)) return null;
  const snippet = toSnippet(cleaned, maxLength);
  return snippet || null;
}

function toNotificationSnippet(
  value: string | null | undefined,
  input: { subject: string; category: string },
  maxLength = 150,
): string | null {
  const cleaned = cleanupNotificationMessage(value ?? "", {
    subject: input.subject,
    category: input.category,
  });
  if (!hasConfidentNotificationMessage(cleaned, input)) return null;
  const snippet = toSnippet(cleaned, maxLength);
  return snippet || null;
}

function renderMailList(items: string[], limit = 8): string {
  if (items.length === 0) return '<p style="margin:0;color:#4b5563;">-</p>';

  const visible = items.slice(0, Math.max(1, limit));
  const hiddenCount = Math.max(0, items.length - visible.length);

  return `
    <ul style="margin:8px 0 0;padding:0 0 0 18px;color:#111827;">
      ${visible.join("")}
    </ul>
    ${hiddenCount > 0 ? `<p style="margin:8px 0 0;color:#6b7280;">${hiddenCount}개 항목은 생략되었습니다. 전체 목록은 대시보드에서 확인하세요.</p>` : ""}
  `;
}

function renderMailSection(title: string, bodyHtml: string, link?: Link): string {
  return `
    <section style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;background:#f9fafb;">
      <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">${escapeHtml(title)}</h2>
      ${bodyHtml}
      ${link
        ? `<p style="margin:12px 0 0;"><a href="${escapeHtml(link.href)}" style="color:#0f3b8a;text-decoration:underline;">${escapeHtml(link.label)}</a></p>`
        : ""}
    </section>
  `;
}

function renderMailLayout(input: {
  title: string;
  subtitle: string;
  summaryRows: SummaryRow[];
  sections: string[];
  primaryLink?: Link;
}): string {
  const summaryRowsHtml = input.summaryRows
    .map(
      (row) => `
        <tr>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#4b5563;white-space:nowrap;">${escapeHtml(row.label)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
  <body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Arial,sans-serif;color:#111827;">
    <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
      <article style="background:#ffffff;border:1px solid #d9e1ea;border-radius:16px;padding:20px;">
        <h1 style="margin:0 0 8px;font-size:22px;color:#0f172a;">${escapeHtml(input.title)}</h1>
        <p style="margin:0 0 16px;color:#334155;">${escapeHtml(input.subtitle)}</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tbody>${summaryRowsHtml}</tbody>
        </table>
        ${input.primaryLink
          ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(input.primaryLink.href)}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0f3b8a;color:#ffffff;text-decoration:none;font-weight:600;">${escapeHtml(input.primaryLink.label)}</a></p>`
          : ""}
        <div style="display:grid;gap:12px;">
          ${input.sections.join("")}
        </div>
        <p style="margin:18px 0 0;color:#6b7280;font-size:12px;">이 메일은 CU12 자동화 워커에서 자동 발송되었습니다.</p>
      </article>
    </div>
  </body>
</html>`;
}

function formatSummaryMeta(parts: Array<string | null | undefined>): string {
  const filtered = parts.map((part) => normalizeInlineText(part)).filter((part) => part.length > 0 && part !== "-");
  return filtered.join(" | ");
}

function renderListItem(lines: Array<{ text: string; muted?: boolean }>): string {
  const visibleLines = lines.filter((line) => isPresent(line.text));
  if (visibleLines.length === 0) return "";

  return `
    <li style="margin:0 0 8px;">
      ${visibleLines.map((line, index) => {
        const style = line.muted ? "margin:0 0 2px;color:#4b5563;" : "margin:0 0 2px;";
        const finalStyle = index === visibleLines.length - 1 ? style.replace("0 0 2px", "0") : style;
        return `<p style="${finalStyle}">${line.text}</p>`;
      }).join("")}
    </li>
  `;
}

function pushSummaryRow(rows: SummaryRow[], label: string, value: string | null | undefined) {
  const normalized = normalizeInlineText(value);
  if (!normalized) return;
  rows.push({ label, value: normalized });
}

export function formatKoDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return parsed.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hour = Math.floor(safe / 3600);
  const minute = Math.floor((safe % 3600) / 60);
  const sec = safe % 60;

  if (hour > 0) {
    return `${hour}시간 ${minute}분 ${sec}초`;
  }
  if (minute > 0) {
    return `${minute}분 ${sec}초`;
  }
  return `${sec}초`;
}

function toPercent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return "0%";
  }
  return `${Math.round((Math.max(0, numerator) / denominator) * 100)}%`;
}

export function buildDashboardLink(baseUrl: string, anchor?: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const dashboard = `${normalizedBase}/dashboard`;
  if (!anchor) return dashboard;
  return `${dashboard}#${encodeURIComponent(anchor)}`;
}

export function formatAutoLearnModeLabel(mode: AutoLearnMode): string {
  if (mode === "SINGLE_NEXT") return "선택 강의: 다음 차시";
  if (mode === "SINGLE_ALL") return "선택 강의: 전체 차시";
  return "진행 중 전체 강의";
}

export function formatAutoLearnNoOpReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "NO_ACTIVE_COURSES") return "진행 중인 강의가 없습니다.";
  if (reason === "LECTURE_NOT_FOUND") return "선택한 강의를 찾을 수 없습니다.";
  if (reason === "NO_PENDING_TASKS") return "미완료 차시가 없습니다.";
  if (reason === "NO_PENDING_SUPPORTED_TASKS") return "미완료 자동 수강 지원 차시가 없습니다.";
  if (reason === "NO_AVAILABLE_SUPPORTED_TASKS") return "현재 학습 가능한 자동 수강 지원 차시가 없습니다.";
  if (reason === "NO_TASKS_AFTER_FILTER") return "필터 적용 후 남은 차시가 없습니다.";
  return reason;
}

export type AutoLearnTerminalStatus = "SUCCEEDED" | "FAILED" | "CANCELED";

export function formatAutoLearnTarget(mode: AutoLearnMode, lectureSeq?: number): string {
  if (mode === "ALL_COURSES") return "진행 중 전체 강의";
  if (typeof lectureSeq === "number" && Number.isFinite(lectureSeq)) {
    return `강의 ${lectureSeq}`;
  }
  return "선택 강의";
}

export function formatAutoLearnTerminalStatus(status: AutoLearnTerminalStatus): string {
  if (status === "SUCCEEDED") return "성공";
  if (status === "CANCELED") return "취소";
  return "실패";
}

export function buildSyncAlertMail(input: {
  dashboardBaseUrl: string;
  generatedAt: Date;
  newNotices: SyncAlertNoticeMailItem[];
  newUnreadNotifications: SyncAlertNotificationMailItem[];
  deadlineAlerts: DeadlineMailItem[];
}): MailDocument | null {
  const noticeItems = input.newNotices
    .map((notice) => {
      const snippet = toNoticeSnippet(notice.bodyText, 160);
      const metaLine = formatSummaryMeta([
        notice.courseTitle,
        notice.author ? `작성자 ${notice.author}` : null,
        notice.postedAt ? `등록 ${formatKoDateTime(notice.postedAt)}` : null,
      ]);

      return renderListItem([
        { text: `<strong>${escapeHtml(notice.title)}</strong>` },
        { text: escapeHtml(metaLine), muted: true },
        { text: snippet ? escapeHtml(snippet) : "" },
      ]);
    })
    .filter((item) => item.length > 0);

  const notificationItems = input.newUnreadNotifications
    .map((event) => {
      const snippet = toNotificationSnippet(event.message, {
        subject: event.courseTitle,
        category: event.category,
      }, 140);
      const occurredAt = formatKoDateTime(event.occurredAt);
      const subjectText = normalizeInlineText(event.courseTitle);
      const categoryText = normalizeInlineText(event.category);
      const hasSummary = subjectText.length > 0 || categoryText.length > 0 || occurredAt !== "-" || Boolean(snippet);
      if (!hasSummary) return "";

      const headerParts = [
        subjectText ? `<strong>${escapeHtml(subjectText)}</strong>` : "",
        categoryText ? escapeHtml(categoryText) : "",
      ].filter((part) => part.length > 0);
      return renderListItem([
        { text: headerParts.join(" | ") || "<strong>알림</strong>" },
        { text: occurredAt !== "-" ? escapeHtml(occurredAt) : "", muted: true },
        { text: snippet ? escapeHtml(snippet) : "" },
      ]);
    })
    .filter((item) => item.length > 0);

  const deadlineItems = input.deadlineAlerts
    .map((task) => renderListItem([
      { text: `<strong>${escapeHtml(task.courseTitle)}</strong> ${task.weekNo}주차 ${task.lessonNo}차시` },
      { text: escapeHtml(`${task.daysLeft <= 0 ? "당일" : `D-${task.daysLeft}`} | 마감 ${formatKoDateTime(task.dueAt)}`), muted: true },
    ]))
    .filter((item) => item.length > 0);

  if (noticeItems.length === 0 && notificationItems.length === 0 && deadlineItems.length === 0) {
    return null;
  }

  const sections: string[] = [];
  const noticeSectionCount = noticeItems.length;
  const notificationSectionCount = notificationItems.length;

  if (noticeSectionCount > 0 || notificationSectionCount > 0) {
    sections.push(
      renderMailSection(
        "공지/알림 요약",
        `<p style="margin:0;color:#111827;">신규 공지 <strong>${noticeSectionCount}</strong>건, 신규 미확인 알림 <strong>${notificationSectionCount}</strong>건입니다.</p>`,
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.NOTIFICATIONS),
          label: "공지/알림 보기",
        },
      ),
    );
  }

  if (noticeItems.length > 0) {
    sections.push(
      renderMailSection(
        "신규 공지",
        renderMailList(noticeItems, 8),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.NOTIFICATIONS),
          label: "전체 공지 보기",
        },
      ),
    );
  }

  if (notificationItems.length > 0) {
    sections.push(
      renderMailSection(
        "신규 미확인 알림",
        renderMailList(notificationItems, 10),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.NOTIFICATIONS),
          label: "알림 센터 보기",
        },
      ),
    );
  }

  if (deadlineItems.length > 0) {
    sections.push(
      renderMailSection(
        "임박 마감 차시",
        renderMailList(deadlineItems, 10),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.DEADLINES),
          label: "마감 목록 보기",
        },
      ),
    );
  }

  const summaryRows: SummaryRow[] = [];
  pushSummaryRow(summaryRows, "생성 시각", formatKoDateTime(input.generatedAt));
  pushSummaryRow(summaryRows, "신규 공지", `${noticeItems.length}건`);
  pushSummaryRow(summaryRows, "신규 미확인 알림", `${notificationItems.length}건`);
  pushSummaryRow(summaryRows, "마감 임박 알림", `${deadlineItems.length}건`);

  return {
    subject: "[CU12] 동기화 알림",
    html: renderMailLayout({
      title: "동기화 알림 리포트",
      subtitle: "최근 동기화에서 감지된 신규 공지, 미확인 알림, 마감 임박 차시입니다.",
      summaryRows,
      sections,
      primaryLink: {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 보기",
      },
    }),
  };
}

export function buildDigestMail(input: {
  dashboardBaseUrl: string;
  generatedAt: Date;
  activeCourseCount: number;
  avgProgress: number;
  unreadNoticeCount: number;
  unreadNotificationCount: number;
  pendingTaskCount: number;
  recentNotices: DigestNoticeMailItem[];
  recentNotifications: DigestNotificationMailItem[];
  dueSoonTasks: DigestDeadlineMailItem[];
}): MailDocument | null {
  const noticeItems = input.recentNotices
    .map((notice) => {
      const snippet = toNoticeSnippet(notice.bodyText, 180);
      const metaLine = formatSummaryMeta([
        notice.courseTitle,
        notice.author ? `작성자 ${notice.author}` : null,
        notice.postedAt ? `등록 ${formatKoDateTime(notice.postedAt)}` : null,
        notice.createdAt ? `수집 ${formatKoDateTime(notice.createdAt)}` : null,
      ]);

      return renderListItem([
        { text: `<strong>${escapeHtml(notice.title)}</strong>` },
        { text: escapeHtml(metaLine), muted: true },
        { text: snippet ? escapeHtml(snippet) : "" },
      ]);
    })
    .filter((item) => item.length > 0);

  const notificationItems = input.recentNotifications
    .map((event) => {
      const snippet = toNotificationSnippet(event.message, {
        subject: event.courseTitle,
        category: event.category,
      }, 170);
      const occurredAt = event.occurredAt ?? event.createdAt;
      const unreadLabel = event.isUnread ? "미확인" : "확인";
      const occurredAtLabel = formatKoDateTime(occurredAt);
      const subjectText = normalizeInlineText(event.courseTitle);
      const categoryText = normalizeInlineText(event.category);
      const hasSummary = subjectText.length > 0 || categoryText.length > 0 || occurredAtLabel !== "-" || Boolean(snippet);
      if (!hasSummary) return "";

      const headerParts = [
        subjectText ? `<strong>${escapeHtml(subjectText)}</strong>` : "",
        categoryText ? escapeHtml(categoryText) : "",
        escapeHtml(unreadLabel),
      ].filter((part) => part.length > 0);
      return renderListItem([
        { text: headerParts.join(" | ") || `<strong>알림</strong> | ${escapeHtml(unreadLabel)}` },
        { text: occurredAtLabel !== "-" ? escapeHtml(occurredAtLabel) : "", muted: true },
        { text: snippet ? escapeHtml(snippet) : "" },
      ]);
    })
    .filter((item) => item.length > 0);

  const deadlineItems = input.dueSoonTasks
    .map((task) => {
      if (!task.dueAt) return "";
      const dueAt = new Date(task.dueAt);
      if (!Number.isFinite(dueAt.getTime())) return "";
      const daysLeft = Math.ceil((dueAt.getTime() - input.generatedAt.getTime()) / (24 * 60 * 60 * 1000));
      return renderListItem([
        { text: `<strong>${escapeHtml(task.courseTitle)}</strong> ${task.weekNo}주차 ${task.lessonNo}차시` },
        { text: escapeHtml(`${daysLeft <= 0 ? "당일" : `D-${daysLeft}`} | 마감 ${formatKoDateTime(dueAt)}`), muted: true },
      ]);
    })
    .filter((item) => item.length > 0);

  if (noticeItems.length === 0 && notificationItems.length === 0 && deadlineItems.length === 0) {
    return null;
  }

  const sections: string[] = [];
  sections.push(
    renderMailSection(
      "24시간 요약",
      `
        <p style="margin:0 0 6px;color:#111827;">최근 24시간 신규 공지: <strong>${noticeItems.length}</strong>건</p>
        <p style="margin:0 0 6px;color:#111827;">최근 24시간 신규 알림: <strong>${notificationItems.length}</strong>건</p>
        <p style="margin:0;color:#111827;">7일 이내 마감 차시: <strong>${deadlineItems.length}</strong>건</p>
      `,
      {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 개요 보기",
      },
    ),
  );

  if (noticeItems.length > 0) {
    sections.push(
      renderMailSection(
        "최근 공지",
        renderMailList(noticeItems, 10),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.NOTIFICATIONS),
          label: "공지 보기",
        },
      ),
    );
  }

  if (notificationItems.length > 0) {
    sections.push(
      renderMailSection(
        "최근 알림",
        renderMailList(notificationItems, 10),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.NOTIFICATIONS),
          label: "알림 보기",
        },
      ),
    );
  }

  if (deadlineItems.length > 0) {
    sections.push(
      renderMailSection(
        "임박 마감 차시",
        renderMailList(deadlineItems, 12),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.DEADLINES),
          label: "마감 목록 보기",
        },
      ),
    );
  }

  const summaryRows: SummaryRow[] = [];
  pushSummaryRow(summaryRows, "생성 시각", formatKoDateTime(input.generatedAt));
  pushSummaryRow(summaryRows, "진행 중 강의", String(input.activeCourseCount));
  pushSummaryRow(summaryRows, "평균 진도", `${Math.round(input.avgProgress)}%`);
  pushSummaryRow(summaryRows, "미확인 공지", String(input.unreadNoticeCount));
  pushSummaryRow(summaryRows, "미확인 알림", String(input.unreadNotificationCount));
  pushSummaryRow(summaryRows, "미완료 차시", String(input.pendingTaskCount));

  return {
    subject: "[CU12] 일일 학습 요약",
    html: renderMailLayout({
      title: "일일 학습 요약",
      subtitle: "최근 24시간 변경 사항과 임박 마감 차시입니다.",
      summaryRows,
      sections,
      primaryLink: {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 보기",
      },
    }),
  };
}

export function buildAutoLearnResultMail(input: {
  dashboardBaseUrl: string;
  generatedAt: Date;
  mode: AutoLearnMode;
  watchedTaskCount: number;
  watchedSeconds: number;
  plannedTaskCount: number;
  truncated: boolean;
  continuationQueued?: boolean;
  chainLimitReached?: boolean;
  chainSegment?: number;
  estimatedTotalSeconds: number;
  noOpReason?: string | null;
  planned?: AutoLearnPlannedTask[];
}): MailDocument {
  const noOpReasonLabel = formatAutoLearnNoOpReason(input.noOpReason);
  const notes: string[] = [];

  if (typeof input.chainSegment === "number" && Number.isFinite(input.chainSegment) && input.chainSegment > 1) {
    notes.push(`연속 실행 세그먼트: ${input.chainSegment}`);
  }
  if (input.truncated) {
    notes.push("이번 실행은 청크 제한으로 분할 처리되었습니다.");
  }
  if (input.continuationQueued) {
    notes.push("다음 자동 수강 청크가 자동으로 예약되었습니다.");
  }
  if (input.chainLimitReached) {
    notes.push("연속 실행 한도에 도달해 추가 예약은 중단되었습니다.");
  }
  if (noOpReasonLabel) {
    notes.push(`실행 없음 사유: ${noOpReasonLabel}`);
  }

  const sections: string[] = [
    renderMailSection(
      "실행 요약",
      `
        <p style="margin:0 0 6px;color:#111827;">모드: <strong>${escapeHtml(formatAutoLearnModeLabel(input.mode))}</strong></p>
        <p style="margin:0 0 6px;color:#111827;">완료 차시: <strong>${input.watchedTaskCount}/${input.plannedTaskCount}</strong> (${toPercent(input.watchedTaskCount, Math.max(1, input.plannedTaskCount))})</p>
        <p style="margin:0 0 6px;color:#111827;">수행 시간: <strong>${escapeHtml(formatDuration(input.watchedSeconds))}</strong></p>
        <p style="margin:0;color:#111827;">예상 총 학습 시간: <strong>${escapeHtml(formatDuration(input.estimatedTotalSeconds))}</strong></p>
      `,
      {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.JOBS),
        label: "작업 상태 보기",
      },
    ),
  ];

  if (notes.length > 0) {
    sections.push(
      renderMailSection(
        "참고 사항",
        renderMailList(notes.map((note) => `<li style="margin:0 0 6px;color:#111827;">${escapeHtml(note)}</li>`), 8),
      ),
    );
  }

  const plannedItems = (input.planned ?? [])
    .map((row) => {
      const remainingSeconds = Math.max(0, row.remainingSeconds);
      const taskMeta = formatSummaryMeta([
        row.taskTitle,
        `잔여 학습 시간 ${formatDuration(remainingSeconds)}`,
      ]);
      return renderListItem([
        { text: `<strong>${escapeHtml(row.courseTitle)}</strong> ${row.weekNo}주차 ${row.lessonNo}차시` },
        { text: escapeHtml(taskMeta), muted: true },
        { text: escapeHtml(`학습 가능 ${formatKoDateTime(row.availableFrom)} ~ 마감 ${formatKoDateTime(row.dueAt)}`), muted: true },
      ]);
    })
    .filter((item) => item.length > 0);

  if (plannedItems.length > 0) {
    sections.push(
      renderMailSection(
        "계획 차시",
        renderMailList(plannedItems, 12),
        {
          href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.COURSES),
          label: "강의 현황 보기",
        },
      ),
    );
  }

  const summaryRows: SummaryRow[] = [];
  pushSummaryRow(summaryRows, "생성 시각", formatKoDateTime(input.generatedAt));
  pushSummaryRow(summaryRows, "모드", formatAutoLearnModeLabel(input.mode));
  pushSummaryRow(summaryRows, "완료 차시", `${input.watchedTaskCount}/${input.plannedTaskCount}`);
  pushSummaryRow(summaryRows, "수행 시간", formatDuration(input.watchedSeconds));

  return {
    subject: "[CU12] 자동 수강 결과",
    html: renderMailLayout({
      title: "자동 수강 결과",
      subtitle: "최근 자동 수강 실행 결과 상세입니다.",
      summaryRows,
      sections,
      primaryLink: {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 보기",
      },
    }),
  };
}

export function buildAutoLearnStartMail(input: {
  dashboardBaseUrl: string;
  generatedAt: Date;
  mode: AutoLearnMode;
  lectureSeq?: number;
  chainSegment?: number;
}): MailDocument {
  const summaryRows: SummaryRow[] = [];
  pushSummaryRow(summaryRows, "시작 시각", formatKoDateTime(input.generatedAt));
  pushSummaryRow(summaryRows, "모드", formatAutoLearnModeLabel(input.mode));
  pushSummaryRow(summaryRows, "대상", formatAutoLearnTarget(input.mode, input.lectureSeq));
  if (typeof input.chainSegment === "number" && Number.isFinite(input.chainSegment) && input.chainSegment > 1) {
    pushSummaryRow(summaryRows, "연속 실행 세그먼트", String(input.chainSegment));
  }

  return {
    subject: "[CU12] 자동 수강 시작",
    html: renderMailLayout({
      title: "자동 수강 시작",
      subtitle: "자동 수강 실행이 시작되었습니다.",
      summaryRows,
      sections: [
        renderMailSection(
          "실행 시작",
          `<p style="margin:0;color:#111827;">자동 수강 실행 시작 알림입니다. 실행이 종료되면 결과 메일을 다시 발송합니다.</p>`,
          {
            href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.JOBS),
            label: "작업 상태 보기",
          },
        ),
      ],
      primaryLink: {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 보기",
      },
    }),
  };
}

export function buildAutoLearnTerminalMail(input: {
  dashboardBaseUrl: string;
  generatedAt: Date;
  status: AutoLearnTerminalStatus;
  mode: AutoLearnMode;
  lectureSeq?: number;
  chainSegment?: number;
  reason?: string | null;
}): MailDocument {
  const statusLabel = formatAutoLearnTerminalStatus(input.status);
  const sections: string[] = [
    renderMailSection(
      "실행 결과",
      `<p style="margin:0;color:#111827;">자동 수강 실행이 <strong>${escapeHtml(statusLabel)}</strong> 상태로 종료되었습니다.</p>`,
      {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.JOBS),
        label: "작업 상태 보기",
      },
    ),
  ];

  if (isPresent(input.reason)) {
    sections.push(
      renderMailSection(
        "사유",
        `<p style="margin:0;color:#111827;">${escapeHtml(normalizeInlineText(input.reason))}</p>`,
      ),
    );
  }

  const summaryRows: SummaryRow[] = [];
  pushSummaryRow(summaryRows, "종료 시각", formatKoDateTime(input.generatedAt));
  pushSummaryRow(summaryRows, "상태", statusLabel);
  pushSummaryRow(summaryRows, "모드", formatAutoLearnModeLabel(input.mode));
  pushSummaryRow(summaryRows, "대상", formatAutoLearnTarget(input.mode, input.lectureSeq));
  if (typeof input.chainSegment === "number" && Number.isFinite(input.chainSegment) && input.chainSegment > 1) {
    pushSummaryRow(summaryRows, "연속 실행 세그먼트", String(input.chainSegment));
  }

  return {
    subject: `[CU12] 자동 수강 종료 (${statusLabel})`,
    html: renderMailLayout({
      title: `자동 수강 ${statusLabel}`,
      subtitle: "최근 자동 수강 실행의 최종 상태입니다.",
      summaryRows,
      sections,
      primaryLink: {
        href: buildDashboardLink(input.dashboardBaseUrl, DASHBOARD_SECTION_ID.OVERVIEW),
        label: "대시보드 보기",
      },
    }),
  };
}
