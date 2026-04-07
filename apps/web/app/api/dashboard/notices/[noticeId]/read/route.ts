import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalProvider } from "@/server/current-provider";

interface Params {
  params: Promise<{ noticeId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const { noticeId } = await params;
  const provider = await getCurrentPortalProvider(context.effective.userId);
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
}
