import { AUTH_RATE_LIMIT_WINDOW_MS } from "@cu12/core";

export const AUDIT_RETENTION_DAYS = 30;
export const JOB_RETENTION_DAYS = 14;
export const MAIL_RETENTION_DAYS = 30;
export const PORTAL_APPROVAL_RETENTION_DAYS = 30;
export const WITHDRAWN_RECORD_RETENTION_MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function monthsAgo(now: Date, months: number): Date {
  const value = new Date(now);
  const originalDayOfMonth = value.getDate();
  value.setDate(1);
  value.setMonth(value.getMonth() - months);
  const lastDayOfTargetMonth = new Date(
    value.getFullYear(),
    value.getMonth() + 1,
    0,
  ).getDate();
  value.setDate(Math.min(originalDayOfMonth, lastDayOfTargetMonth));
  return value;
}

export function buildRetentionCutoffs(now: Date) {
  return {
    audit: daysAgo(now, AUDIT_RETENTION_DAYS),
    job: daysAgo(now, JOB_RETENTION_DAYS),
    mail: daysAgo(now, MAIL_RETENTION_DAYS),
    portalApproval: daysAgo(now, PORTAL_APPROVAL_RETENTION_DAYS),
    withdrawnRecord: monthsAgo(now, WITHDRAWN_RECORD_RETENTION_MONTHS),
  };
}

export function buildExpiredPortalSessionWhere(now: Date) {
  return {
    OR: [
      { status: { in: ["EXPIRED", "INVALID"] as Array<"EXPIRED" | "INVALID"> } },
      { expiresAt: { lte: now } },
    ],
  };
}

export function buildExpiredPortalApprovalWhere(now: Date) {
  return {
    status: {
      in: ["COMPLETED", "EXPIRED", "CANCELED"] as Array<"COMPLETED" | "EXPIRED" | "CANCELED">,
    },
    updatedAt: { lt: daysAgo(now, PORTAL_APPROVAL_RETENTION_DAYS) },
  };
}

export function buildExpiredAuthRateLimitWhere(now: Date) {
  return {
    OR: [
      { blockedUntil: { lte: now } },
      {
        blockedUntil: null,
        windowStart: { lt: new Date(now.getTime() - AUTH_RATE_LIMIT_WINDOW_MS) },
      },
    ],
  };
}
