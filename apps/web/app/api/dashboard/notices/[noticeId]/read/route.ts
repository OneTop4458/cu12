import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

interface Params {
  params: Promise<{ noticeId: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const { noticeId } = await params;
  const updated = await prisma.courseNotice.updateMany({
    where: {
      id: noticeId,
      userId: session.userId,
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
