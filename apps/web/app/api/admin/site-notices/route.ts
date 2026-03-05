import { NextRequest } from "next/server";
import { z } from "zod";
import { SiteNoticeType } from "@prisma/client";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { createSiteNotice, listSiteNotices } from "@/server/site-notice";
import { writeAuditLog } from "@/server/audit-log";

const CreateSiteNoticeSchema = z.object({
  type: z.nativeEnum(SiteNoticeType),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(3000).optional(),
  isActive: z.boolean().default(true),
  priority: z.number().int().min(-999).max(999).default(0),
  visibleFrom: z.string().datetime().nullable().optional(),
  visibleTo: z.string().datetime().nullable().optional(),
});

const QuerySchema = z.object({
  includeInactive: z
    .string()
    .transform((value) => value === "1" || value.toLowerCase() === "true")
    .optional(),
});

function toDateOrNull(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE");
  }
  return date;
}

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  const includeInactive = query.success ? query.data.includeInactive === true : false;
  try {
    const notices = await listSiteNotices(undefined, includeInactive);
    return jsonOk({ siteNotices: notices });
  } catch {
    return jsonError("Failed to load site notices", 500);
  }
}

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const body = await parseBody(request, CreateSiteNoticeSchema);
    const visibleFrom = toDateOrNull(body.visibleFrom ?? null);
    const visibleTo = toDateOrNull(body.visibleTo ?? null);
    const isActive = body.isActive ?? true;
    const priority = body.priority ?? 0;

    if (visibleFrom && visibleTo && visibleFrom.getTime() > visibleTo.getTime()) {
      return jsonError("visibleFrom must be earlier than visibleTo", 400, "VALIDATION_ERROR");
    }

    const created = await createSiteNotice(context.actor.userId, {
      type: body.type,
      title: body.title.trim(),
      message: body.message?.trim() ?? "",
      isActive,
      priority,
      visibleFrom: visibleFrom ? visibleFrom.toISOString() : null,
      visibleTo: visibleTo ? visibleTo.toISOString() : null,
    });

    await writeAuditLog({
      category: "ADMIN",
      actorUserId: context.actor.userId,
      severity: "INFO",
      message: "Site notice created",
      meta: {
        noticeId: created.id,
        title: created.title,
        type: created.type,
      },
    });

    return jsonOk({ created: true, notice: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    if (error instanceof Error && error.message === "INVALID_DATE") {
      return jsonError("Invalid datetime format", 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to create site notice", 500);
  }
}
