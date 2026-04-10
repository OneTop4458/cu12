import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/http";

import { listPublicSiteNotices } from "@/server/site-notice";
import { SiteNoticeType } from "@prisma/client";
import { z } from "zod";

const QuerySchema = z.object({
  type: z.nativeEnum(SiteNoticeType).optional(),
});

function toPublicNotice(
  notice: Awaited<ReturnType<typeof listPublicSiteNotices>>[number],
) {
  return {
    id: notice.id,
    title: notice.title,
    message: notice.message,
    type: notice.type,
    displayTarget: notice.displayTarget,
    isActive: notice.isActive,
    priority: notice.priority,
    visibleFrom: notice.visibleFrom,
    visibleTo: notice.visibleTo,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({ type: params.get("type") ?? undefined });
  if (!parsed.success) {
    return jsonError("Invalid notice type", 400, "VALIDATION_ERROR");
  }

  const notices = await listPublicSiteNotices(parsed.data.type);
  return jsonOk({ siteNotices: notices.map(toPublicNotice) });
}
