import { NextRequest } from "next/server";
import { jsonOk, jsonError } from "@/lib/http";

import { listSiteNotices } from "@/server/site-notice";
import { SiteNoticeType } from "@prisma/client";
import { z } from "zod";

const QuerySchema = z.object({
  type: z.nativeEnum(SiteNoticeType).optional(),
});

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({ type: params.get("type") ?? undefined });
  if (!parsed.success) {
    return jsonError("Invalid notice type", 400, "VALIDATION_ERROR");
  }

  const notices = await listSiteNotices(parsed.data.type, false);
  return jsonOk({ siteNotices: notices });
}
