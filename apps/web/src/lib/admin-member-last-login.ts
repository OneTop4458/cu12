const ADMIN_MEMBER_LAST_LOGIN_FORMATTER = new Intl.DateTimeFormat("ko-KR-u-hc-h23", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatAdminMemberLastLogin(value: string | null): string {
  if (!value) return "로그인 이력 없음";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "로그인 이력 없음";

  return ADMIN_MEMBER_LAST_LOGIN_FORMATTER.format(date);
}
