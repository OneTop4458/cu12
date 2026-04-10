import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { resolveRequestPortalProvider } from "@/server/request-provider";

interface Params {
  params: Promise<{ noticeId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const { noticeId } = await params;
    const provider = await resolveRequestPortalProvider(request, context.effective.userId);
    const updated = await prisma.courseNotice.updateMany({
      where: {
        id: noticeId,
        userId: context.effective.userId,
        provider,
      },
      data: {
        isRead: true,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return jsonError("Notice not found", 404);
    }

    return jsonOk({ updated: true });
  } catch (error) {
    console.error("[dashboard/notice-read] failed", error);
    return jsonError("Failed to update notice state.", 503, "DASHBOARD_NOTICE_READ_FAILED");
  }
}
