import { resolveScheduledSyncInterval, resolveSyncProviders } from "@cu12/core";
import { prisma } from "./prisma";

export async function loadSyncSchedules(userIds: string[], minimumMinutes: number) {
  const now = new Date();
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      cu12Account: { select: { campus: true, autoLearnEnabled: true, detectActivitiesEnabled: true, emailDigestEnabled: true } },
      courseSnapshots: { where: { status: "ACTIVE" }, select: { provider: true } },
      mailSubs: { where: { enabled: true }, select: { alertOnNotice: true, alertOnDeadline: true, digestEnabled: true } },
      learningTasks: {
        where: { state: "PENDING", dueAt: { gte: now, lte: new Date(now.getTime() + 48 * 60 * 60_000) } },
        select: { provider: true },
      },
      providerSyncStates: { select: { provider: true, lastFullSyncAt: true } },
    },
  });
  const schedules = new Map<string, { intervalMinutes: number; lastFullSyncAt: Date | null }>();
  for (const user of rows) {
    if (!user.cu12Account) continue;
    for (const provider of resolveSyncProviders(user.cu12Account.campus)) {
      // Do not let a fresh snapshot suppress a later scheduled deadline-alert threshold.
      const deadlineCheckDue = user.mailSubs.some((mail) => mail.alertOnDeadline)
        && user.learningTasks.some((task) => task.provider === provider);
      schedules.set(`${user.id}:${provider}`, {
        intervalMinutes: deadlineCheckDue ? 0 : resolveScheduledSyncInterval({
          minimumMinutes,
          ...user.cu12Account,
          hasActiveCourses: user.courseSnapshots.some((course) => course.provider === provider),
          hasImportantMail: user.mailSubs.some((mail) => mail.alertOnNotice || mail.alertOnDeadline || mail.digestEnabled),
        }),
        lastFullSyncAt: user.providerSyncStates.find((state) => state.provider === provider)?.lastFullSyncAt ?? null,
      });
    }
  }
  return schedules;
}
