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
