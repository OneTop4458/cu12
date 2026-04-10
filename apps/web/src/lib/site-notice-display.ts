export const SITE_NOTICE_TYPES = ["BROADCAST", "MAINTENANCE"] as const;
export const SITE_NOTICE_DISPLAY_TARGETS = ["LOGIN", "TOPBAR", "BOTH"] as const;
export const SITE_NOTICE_SURFACES = ["LOGIN", "TOPBAR"] as const;

export type SiteNoticeTypeValue = (typeof SITE_NOTICE_TYPES)[number];
export type SiteNoticeDisplayTargetValue = (typeof SITE_NOTICE_DISPLAY_TARGETS)[number];
export type SiteNoticeSurface = (typeof SITE_NOTICE_SURFACES)[number];

export function normalizeSiteNoticeDisplayTarget(
  type: SiteNoticeTypeValue,
  displayTarget: SiteNoticeDisplayTargetValue | null | undefined,
): SiteNoticeDisplayTargetValue {
  if (type === "MAINTENANCE") {
    return "TOPBAR";
  }

  return displayTarget ?? "BOTH";
}

export function isSiteNoticeVisibleOnSurface(input: {
  type: SiteNoticeTypeValue;
  displayTarget: SiteNoticeDisplayTargetValue | null | undefined;
  surface: SiteNoticeSurface;
}): boolean {
  const effectiveDisplayTarget = normalizeSiteNoticeDisplayTarget(input.type, input.displayTarget);

  if (input.type === "MAINTENANCE") {
    return input.surface === "TOPBAR";
  }

  if (input.surface === "LOGIN") {
    return effectiveDisplayTarget === "LOGIN" || effectiveDisplayTarget === "BOTH";
  }

  return effectiveDisplayTarget === "TOPBAR" || effectiveDisplayTarget === "BOTH";
}

export function formatSiteNoticeDisplayTargetLabel(
  type: SiteNoticeTypeValue,
  displayTarget: SiteNoticeDisplayTargetValue | null | undefined,
): string {
  if (type === "MAINTENANCE") {
    return "대시보드 상단 고정";
  }

  switch (normalizeSiteNoticeDisplayTarget(type, displayTarget)) {
    case "LOGIN":
      return "로그인만";
    case "TOPBAR":
      return "상단만";
    case "BOTH":
    default:
      return "로그인+상단";
  }
}
