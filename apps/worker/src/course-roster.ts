import type { CourseState, LearningTask } from "@cu12/core";
import { load } from "cheerio";

export type CourseRosterAssessmentReason =
  | "AUTHORITATIVE_ENTRIES"
  | "AUTHORITATIVE_EMPTY"
  | "AUTHENTICATION_PAGE"
  | "ROUTE_MISMATCH"
  | "PARTIAL_PARSE"
  | "ROSTER_MARKER_MISSING";

export interface CourseRosterAssessment {
  authoritative: boolean;
  reason: CourseRosterAssessmentReason;
}

interface AssessCourseRosterInput {
  html: string;
  currentUrl: string;
  expectedPath: string;
  sourceIdentifiers: string[];
  parsedIdentifiers: string[];
}

const EMPTY_ROSTER_PATTERNS = [
  /(?:등록|수강|진행|현재|조회)?[^\n]{0,20}(?:강좌|강의|과목)[^\n]{0,20}(?:없습니다|없음|존재하지\s*않습니다)/i,
  /no\s+(?:active\s+|current\s+|enrolled\s+)?courses?\b/i,
];

function uniqueIdentifiers(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isAuthenticationHtml(html: string): boolean {
  const $ = load(html);
  return $("input[type='password']").length > 0
    || $("form[action*='login'], form[id*='login'], form[class*='login']").length > 0;
}

function hasExplicitEmptyRosterMessage(html: string): boolean {
  const text = load(html)("body").text().replace(/\s+/g, " ").trim();
  return EMPTY_ROSTER_PATTERNS.some((pattern) => pattern.test(text));
}

function getKoreanAcademicTermStart(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return Number.NaN;
  }
  if (month === 1) {
    return Date.parse(`${year - 1}-08-01T00:00:00+09:00`);
  }
  if (month < 8) {
    return Date.parse(`${year}-02-01T00:00:00+09:00`);
  }
  return Date.parse(`${year}-08-01T00:00:00+09:00`);
}

function toCourseDateEnd(value: string | null | undefined): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? Date.parse(`${normalized}T23:59:59.999+09:00`)
    : Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function filterPriorTermCu12Courses(
  courses: CourseState[],
  tasks: LearningTask[],
  now = new Date(),
): CourseState[] {
  const currentTermStart = getKoreanAcademicTermStart(now);
  if (!Number.isFinite(currentTermStart)) return courses;

  const latestTaskDueAtByLecture = new Map<number, number>();
  for (const task of tasks) {
    const dueAt = toCourseDateEnd(task.dueAt);
    if (dueAt === null) continue;
    latestTaskDueAtByLecture.set(
      task.lectureSeq,
      Math.max(latestTaskDueAtByLecture.get(task.lectureSeq) ?? 0, dueAt),
    );
  }

  return courses.filter((course) => {
    const periodEnd = toCourseDateEnd(course.periodEnd);
    if (periodEnd !== null) {
      return periodEnd >= currentTermStart;
    }

    const latestTaskDueAt = latestTaskDueAtByLecture.get(course.lectureSeq);
    return latestTaskDueAt === undefined || latestTaskDueAt >= currentTermStart;
  });
}

export function assessCourseRoster(input: AssessCourseRosterInput): CourseRosterAssessment {
  let pathname = "";
  try {
    pathname = new URL(input.currentUrl).pathname;
  } catch {
    return { authoritative: false, reason: "ROUTE_MISMATCH" };
  }

  if (pathname !== input.expectedPath) {
    return { authoritative: false, reason: "ROUTE_MISMATCH" };
  }
  if (isAuthenticationHtml(input.html)) {
    return { authoritative: false, reason: "AUTHENTICATION_PAGE" };
  }

  const sourceIdentifiers = uniqueIdentifiers(input.sourceIdentifiers);
  const parsedIdentifiers = uniqueIdentifiers(input.parsedIdentifiers);
  const sourceSet = new Set(sourceIdentifiers);
  const parseMatchesSource = parsedIdentifiers.every((identifier) => sourceSet.has(identifier));

  if (sourceIdentifiers.length > 0) {
    if (sourceIdentifiers.length !== parsedIdentifiers.length || !parseMatchesSource) {
      return { authoritative: false, reason: "PARTIAL_PARSE" };
    }
    return { authoritative: true, reason: "AUTHORITATIVE_ENTRIES" };
  }

  if (parsedIdentifiers.length > 0) {
    return { authoritative: false, reason: "PARTIAL_PARSE" };
  }
  if (hasExplicitEmptyRosterMessage(input.html)) {
    return { authoritative: true, reason: "AUTHORITATIVE_EMPTY" };
  }
  return { authoritative: false, reason: "ROSTER_MARKER_MISSING" };
}

export function extractCu12CourseRosterIdentifiers(html: string): string[] {
  const $ = load(html);
  return $("a[href^='javascript:enterClass(']")
    .toArray()
    .map((element) => $(element).attr("href")?.match(/enterClass\((\d+)\)/)?.[1] ?? "")
    .map((value) => value ? String(Number(value)) : "")
    .filter(Boolean);
}

export function extractCyberCampusCourseRosterIdentifiers(html: string): string[] {
  const $ = load(html);
  return $("em.sub_open[kj], em.sub_open[onclick*='eclassRoom']")
    .toArray()
    .map((element) => {
      const node = $(element);
      return (
        node.attr("kj")
        ?? node.attr("onclick")?.match(/eclassRoom\('([^']+)'\)/)?.[1]
        ?? ""
      ).trim();
    })
    .filter(Boolean);
}
