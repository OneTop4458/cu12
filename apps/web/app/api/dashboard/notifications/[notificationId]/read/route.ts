import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { resolveRequestPortalProvider } from "@/server/request-provider";

interface Params {
  params: Promise<{ notificationId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const { notificationId } = await params;
    const provider = await resolveRequestPortalProvider(request, context.effective.userId);
    const updated = await prisma.notificationEvent.updateMany({
      where: {
        id: notificationId,
        userId: context.effective.userId,
        provider,
      },
      data: {
        isUnread: false,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return jsonError("Notification not found", 404);
    }

    return jsonOk({ updated: true });
  } catch (error) {
    console.error("[dashboard/notification-read] failed", error);
    return jsonError("Failed to update notification state.", 503, "DASHBOARD_NOTIFICATION_READ_FAILED");
  }
}
