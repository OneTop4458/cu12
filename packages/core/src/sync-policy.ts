import type { PortalProvider } from "./types";

export function buildSyncIdempotencyKey(userId: string, provider: PortalProvider): string {
  return `sync:${userId}:${provider}:full`;
}

export function resolveScheduledSyncInterval(input: {
  minimumMinutes: number;
  hasActiveCourses: boolean;
  autoLearnEnabled: boolean;
  detectActivitiesEnabled: boolean;
  emailDigestEnabled: boolean;
  hasImportantMail: boolean;
}): number {
  if (input.minimumMinutes <= 0) return 0;
  const needsRegularSync = input.hasActiveCourses || input.autoLearnEnabled
    || input.detectActivitiesEnabled || input.emailDigestEnabled || input.hasImportantMail;
  return needsRegularSync ? input.minimumMinutes : Math.max(1440, input.minimumMinutes);
}

export function isFullSyncFresh(lastFullSyncAt: Date | null | undefined, intervalMinutes: number, now = new Date()): boolean {
  if (!lastFullSyncAt || intervalMinutes <= 0) return false;
  const ageMs = now.getTime() - lastFullSyncAt.getTime();
  // A pass finishing just after cron must not defer the next pass for another
  // twelve hours. Allow small setup/runtime/scheduler drift at the due boundary.
  const dueSlackMinutes = Math.min(15, intervalMinutes * 0.05);
  return ageMs >= 0 && ageMs < (intervalMinutes - dueSlackMinutes) * 60_000;
}
