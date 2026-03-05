import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getNotifications } from "@/server/dashboard";

const DeleteNotificationsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(50),
});

export async function GET(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const notifications = await getNotifications(context.effective.userId, { unreadOnly, limit });
  return jsonOk({ notifications });
}

export async function DELETE(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const payload = await parseBody(request, DeleteNotificationsSchema);
    const ids = Array.from(new Set(payload.ids));

    const result = await prisma.notificationEvent.deleteMany({
      where: {
        userId: context.effective.userId,
        id: { in: ids },
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

