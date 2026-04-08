import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getNotifications } from "@/server/dashboard";
import { resolveRequestPortalProvider } from "@/server/request-provider";

const DeleteNotificationsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const historyOnly = url.searchParams.get("historyOnly") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const provider = await resolveRequestPortalProvider(request, context.effective.userId);

  const notifications = await getNotifications(context.effective.userId, provider, {
    unreadOnly,
    includeArchived,
    historyOnly,
    limit,
  });
  return jsonOk({
    notifications: notifications.map((notification) => ({
      ...notification,
      provider,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const payload = await parseBody(request, DeleteNotificationsSchema);
    const ids = Array.from(new Set(payload.ids));
    const provider = await resolveRequestPortalProvider(request, context.effective.userId);

    const result = await prisma.notificationEvent.updateMany({
      where: {
        userId: context.effective.userId,
        provider,
        id: { in: ids },
      },
      data: {
        isUnread: false,
        isArchived: true,
        updatedAt: new Date(),
      },
    });

    return jsonOk({ deletedCount: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to delete notifications", 500);
  }
}

