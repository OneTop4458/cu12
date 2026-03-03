import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";

interface Params {
  params: Promise<{ notificationId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { notificationId } = await params;
  const updated = await prisma.notificationEvent.updateMany({
    where: {
      id: notificationId,
      userId: context.effective.userId,
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
}
