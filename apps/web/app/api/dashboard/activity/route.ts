import { PORTAL_PROVIDERS, type PortalProvider } from "@cu12/core";
import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getActivity } from "@/server/dashboard";
import { loadOptionalDashboardSegment } from "@/server/dashboard-fallback";

const ActivityKindSchema = z.enum(["NOTICE", "NOTIFICATION", "MESSAGE", "SYSTEM"]);
const PortalProviderSchema = z.enum(["CU12", "CYBER_CAMPUS"]);

const ActivityItemSchema = z.object({
  kind: ActivityKindSchema,
  id: z.string().trim().min(1),
  provider: PortalProviderSchema,
});

const ReadActivitySchema = z.object({
  markAll: z.literal(true).optional(),
  items: z.array(ActivityItemSchema).min(1).max(50).optional(),
}).refine((payload) => payload.markAll === true || (payload.items?.length ?? 0) > 0, {
  message: "Either markAll or items is required.",
});

function normalizeProvider(value: string | null): PortalProvider | null {
  if (value === "CU12" || value === "CYBER_CAMPUS") return value;
  return null;
}

function serializeDate(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const url = new URL(request.url);
    const provider = normalizeProvider(url.searchParams.get("provider"));
    const limitRaw = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
    const providers = provider ? [provider] : PORTAL_PROVIDERS;

    const payloads = await Promise.all(
      providers.map((itemProvider) =>
        loadOptionalDashboardSegment(
          "dashboard/activity",
          "activity",
          () => getActivity(context.effective.userId, itemProvider, limit),
          [],
        )),
    );
    const activities = payloads
      .flat()
      .sort((a, b) => {
        const attentionDelta = Number(b.needsAttention) - Number(a.needsAttention);
        if (attentionDelta !== 0) return attentionDelta;
        const bTime = new Date(b.occurredAt ?? b.createdAt).getTime();
        const aTime = new Date(a.occurredAt ?? a.createdAt).getTime();
        return bTime - aTime;
      })
      .slice(0, limit)
      .map((item) => ({
        ...item,
        occurredAt: serializeDate(item.occurredAt),
        createdAt: serializeDate(item.createdAt),
      }));

    return jsonOk({
      activities,
      attentionCount: activities.filter((item) => item.needsAttention).length,
    });
  } catch (error) {
    console.error("[dashboard/activity] failed", error);
    return jsonError("Dashboard activity failed. Please refresh and try again.", 503, "DASHBOARD_ACTIVITY_FAILED");
  }
}

export async function PATCH(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const payload = await parseBody(request, ReadActivitySchema);
    const now = new Date();

    if (payload.markAll === true) {
      const [noticeResult, notificationResult, messageResult] = await prisma.$transaction([
        prisma.courseNotice.updateMany({
          where: {
            userId: context.effective.userId,
            isRead: false,
          },
          data: { isRead: true, updatedAt: now },
        }),
        prisma.notificationEvent.updateMany({
          where: {
            userId: context.effective.userId,
            isUnread: true,
            isArchived: false,
          },
          data: { isUnread: false, updatedAt: now },
        }),
        prisma.portalMessage.updateMany({
          where: {
            userId: context.effective.userId,
            isRead: false,
            isArchived: false,
          },
          data: { isRead: true, updatedAt: now },
        }),
      ]);

      return jsonOk({
        updated: true,
        updatedCount: noticeResult.count + notificationResult.count + messageResult.count,
      });
    }

    const groups: Record<PortalProvider, Record<z.infer<typeof ActivityKindSchema>, string[]>> = {
      CU12: { NOTICE: [], NOTIFICATION: [], MESSAGE: [], SYSTEM: [] },
      CYBER_CAMPUS: { NOTICE: [], NOTIFICATION: [], MESSAGE: [], SYSTEM: [] },
    };

    for (const item of payload.items ?? []) {
      if (item.kind === "SYSTEM") continue;
      groups[item.provider][item.kind].push(item.id);
    }

    let updatedCount = 0;
    for (const provider of PORTAL_PROVIDERS) {
      const noticeIds = Array.from(new Set(groups[provider].NOTICE));
      const notificationIds = Array.from(new Set(groups[provider].NOTIFICATION));
      const messageIds = Array.from(new Set(groups[provider].MESSAGE));

      if (noticeIds.length > 0) {
        const result = await prisma.courseNotice.updateMany({
          where: { userId: context.effective.userId, provider, id: { in: noticeIds } },
          data: { isRead: true, updatedAt: now },
        });
        updatedCount += result.count;
      }

      if (notificationIds.length > 0) {
        const result = await prisma.notificationEvent.updateMany({
          where: { userId: context.effective.userId, provider, id: { in: notificationIds } },
          data: { isUnread: false, updatedAt: now },
        });
        updatedCount += result.count;
      }

      if (messageIds.length > 0) {
        const result = await prisma.portalMessage.updateMany({
          where: { userId: context.effective.userId, provider, id: { in: messageIds } },
          data: { isRead: true, updatedAt: now },
        });
        updatedCount += result.count;
      }
    }

    return jsonOk({ updated: true, updatedCount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    console.error("[dashboard/activity/read] failed", error);
    return jsonError("Failed to update activity state.", 503, "DASHBOARD_ACTIVITY_READ_FAILED");
  }
}
