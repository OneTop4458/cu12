import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { getCourses, getDashboardSummary, getMessages, getNotifications, getUpcomingDeadlines } from "@/server/dashboard";
import { getSyncQueueSummaryForUser, listJobsForUser } from "@/server/queue";
import { listSiteNotices } from "@/server/site-notice";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function resolveMailPreference(userId: string) {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        cu12Account: {
          select: {
            emailDigestEnabled: true,
          },
        },
      },
    }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  if (!user) {
    return null;
  }

  const accountDigestEnabled = user.cu12Account?.emailDigestEnabled ?? true;

  if (!subscription) {
    return {
      email: user.email,
      enabled: true,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: accountDigestEnabled,
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
    digestEnabled: subscription.digestEnabled && accountDigestEnabled,
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
  const messagesLimit = parseLimit(url.searchParams.get("messagesLimit"), 20, 100);
  const jobsLimit = parseLimit(url.searchParams.get("jobsLimit"), 20, 100);
  const userId = context.effective.userId;
  const account = await getDashboardAccount(userId);
  const provider = account?.provider ?? "CU12";

  const [summary, courses, deadlines, notifications, messages, jobs, syncQueue, siteNotices, preference, cyberCampus] = await Promise.all([
    getDashboardSummary(userId, provider),
    getCourses(userId, provider),
    getUpcomingDeadlines(userId, deadlinesLimit, provider),
    getNotifications(userId, provider, { unreadOnly: true, limit: notificationsLimit }),
    getMessages(userId, provider, messagesLimit),
    listJobsForUser(userId, jobsLimit),
    getSyncQueueSummaryForUser(userId),
    listSiteNotices(undefined, false),
    resolveMailPreference(userId),
    provider === "CYBER_CAMPUS"
      ? getCyberCampusApprovalState(userId)
      : Promise.resolve({
        session: {
          available: false,
          status: null,
          expiresAt: null,
          lastVerifiedAt: null,
        },
        approval: null,
      }),
  ]);

  if (!preference) {
    return jsonError("User not found", 404);
  }
  const maintenanceNotice = siteNotices.find((notice) => notice.type === SiteNoticeType.MAINTENANCE) ?? null;

  return jsonOk(
    {
      context: {
        actor: context.actor,
        effective: context.effective,
        impersonating: context.impersonating,
      },
      summary,
      courses,
      deadlines,
      notifications,
      messages,
      jobs,
      syncQueue,
      siteNotices,
      maintenanceNotice,
      account: account
        ? {
          provider: account.provider,
          cu12Id: account.cu12Id,
          campus: account.campus,
          accountStatus: account.accountStatus,
          statusReason: account.statusReason,
          autoLearnEnabled: account.autoLearnEnabled,
          quizAutoSolveEnabled: account.quizAutoSolveEnabled,
          lastLoginAt: account.user.lastLoginAt,
          lastLoginIp: account.user.lastLoginIp,
        }
        : null,
      cyberCampus,
      preference,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
