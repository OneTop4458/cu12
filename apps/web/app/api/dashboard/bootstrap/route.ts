import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getCourses, getDashboardSummary, getNotifications, getUpcomingDeadlines } from "@/server/dashboard";
import { listJobsForUser } from "@/server/queue";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function resolveMailPreference(userId: string) {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  if (!user) {
    return null;
  }

  if (!subscription) {
    return {
      email: user.email,
      enabled: true,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: true,
      digestHour: 8,
      updatedAt: null,
    };
  }

  return {
    email: subscription.email,
    enabled: subscription.enabled,
    alertOnNotice: subscription.alertOnNotice,
    alertOnDeadline: subscription.alertOnDeadline,
    alertOnAutolearn: subscription.alertOnAutolearn,
    digestEnabled: subscription.digestEnabled,
    digestHour: subscription.digestHour,
    updatedAt: subscription.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const deadlinesLimit = parseLimit(url.searchParams.get("deadlinesLimit"), 20, 100);
  const notificationsLimit = parseLimit(url.searchParams.get("notificationsLimit"), 40, 200);
  const jobsLimit = parseLimit(url.searchParams.get("jobsLimit"), 20, 100);
  const userId = context.effective.userId;

  const [summary, courses, deadlines, notifications, jobs, account, preference] = await Promise.all([
    getDashboardSummary(userId),
    getCourses(userId),
    getUpcomingDeadlines(userId, deadlinesLimit),
    getNotifications(userId, { limit: notificationsLimit }),
    listJobsForUser(userId, jobsLimit),
    prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        cu12Id: true,
        campus: true,
        accountStatus: true,
        statusReason: true,
      },
    }),
    resolveMailPreference(userId),
  ]);

  if (!preference) {
    return jsonError("User not found", 404);
  }

  return jsonOk({
    context: {
      actor: context.actor,
      effective: context.effective,
      impersonating: context.impersonating,
    },
    summary,
    courses,
    deadlines,
    notifications,
    jobs,
    account,
    preference,
  });
}
