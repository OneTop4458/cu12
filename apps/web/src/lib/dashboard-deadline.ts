export type DashboardDeadlineActivityType = "VOD" | "MATERIAL" | "QUIZ" | "ASSIGNMENT" | "ETC";

function formatDeadlineSeconds(value: number): string {
  const sec = Math.max(0, Math.floor(value));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

function formatDeadlineDays(days: number | null): string {
  if (days === null) return "-";
  if (days < 0) return "마감 지남";
  if (days === 0) return "오늘 마감";
  return `D-${days}`;
}

export function getDashboardDeadlineActivityLabel(activityType: DashboardDeadlineActivityType): string {
  switch (activityType) {
    case "QUIZ":
      return "퀴즈";
    case "ASSIGNMENT":
      return "과제";
    case "MATERIAL":
      return "자료";
    case "ETC":
      return "기타";
    case "VOD":
    default:
      return "영상";
  }
}

export function formatDashboardDeadlineRemainingLabel(input: {
  activityType: DashboardDeadlineActivityType;
  daysLeft: number | null;
  remainingSeconds: number;
}): string {
  const dayLabel = formatDeadlineDays(input.daysLeft);
  if (input.activityType !== "VOD" && input.remainingSeconds <= 0) {
    return `${dayLabel} / ${getDashboardDeadlineActivityLabel(input.activityType)}`;
  }
  return `${dayLabel} / ${formatDeadlineSeconds(input.remainingSeconds)}`;
}
