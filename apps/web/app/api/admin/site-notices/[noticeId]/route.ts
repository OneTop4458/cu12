import { NextRequest } from "next/server";
import { z } from "zod";
import { SiteNoticeType } from "@prisma/client";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { updateSiteNotice } from "@/server/site-notice";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

interface Params {
  params: Promise<{ noticeId: string }>;
}

const UpsertNoticeSchema = z.object({
  type: z.nativeEnum(SiteNoticeType).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(3000).optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(-999).max(999).optional(),
  visibleFrom: z.string().datetime().nullable().optional(),
  visibleTo: z.string().datetime().nullable().optional(),
});

function normalizeDate(value?: string | null) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_DATE");
  }
  return date.toISOString();
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { noticeId } = await params;
    const body = await parseBody(request, UpsertNoticeSchema);
    if (Object.keys(body).length === 0) {
      return jsonError("No update fields provided", 400, "VALIDATION_ERROR");
    }

    const patchPayload: {
      type?: SiteNoticeType;
      title?: string;
      message?: string;
      isActive?: boolean;
      priority?: number;
      visibleFrom?: string | null;
      visibleTo?: string | null;
    } = {
      type: body.type,
      title: body.title?.trim(),
      message: body.message?.trim(),
      isActive: body.isActive,
      priority: body.priority,
    };

    if (body.visibleFrom !== undefined) patchPayload.visibleFrom = normalizeDate(body.visibleFrom);
    if (body.visibleTo !== undefined) patchPayload.visibleTo = normalizeDate(body.visibleTo);

    const existing = await prisma.siteNotice.findUnique({ where: { id: noticeId } });
    if (!existing) return jsonError("Notice not found", 404, "SITE_NOTICE_NOT_FOUND");

    const nextVisibleFrom = body.visibleFrom !== undefined
      ? normalizeDate(body.visibleFrom)
      : existing.visibleFrom?.toISOString() ?? null;
    const nextVisibleTo = body.visibleTo !== undefined
      ? normalizeDate(body.visibleTo)
      : existing.visibleTo?.toISOString() ?? null;
    const nextVisibleFromDate = nextVisibleFrom ? new Date(nextVisibleFrom) : null;
    const nextVisibleToDate = nextVisibleTo ? new Date(nextVisibleTo) : null;

    if (nextVisibleFromDate && nextVisibleToDate && nextVisibleFromDate > nextVisibleToDate) {
      return jsonError("visibleFrom must be earlier than visibleTo", 400, "VALIDATION_ERROR");
    }

    const notice = await updateSiteNotice(noticeId, patchPayload);
    await writeAuditLog({
      category: "ADMIN",
      actorUserId: context.actor.userId,
      severity: "INFO",
      message: "Site notice updated",
      meta: {
        noticeId,
        type: notice.type,
      },
    });

    return jsonOk({ updated: true, notice });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((issue) => issue.message).join(", "), 400, "VALIDATION_ERROR");
    }
    if (error instanceof Error && error.message === "INVALID_DATE") {
      return jsonError("Invalid datetime format", 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to update site notice", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const { noticeId } = await params;

    const existing = await prisma.siteNotice.findUnique({ where: { id: noticeId } });
    if (!existing) return jsonError("Notice not found", 404, "SITE_NOTICE_NOT_FOUND");

    await prisma.siteNotice.delete({ where: { id: noticeId } });

    await writeAuditLog({
      category: "ADMIN",
      actorUserId: context.actor.userId,
      severity: "WARN",
      message: "Site notice deleted",
      meta: {
        noticeId: existing.id,
        title: existing.title,
      },
    });

    return jsonOk({ deleted: true, noticeId });
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return jsonError("Notice not found", 404, "SITE_NOTICE_NOT_FOUND");
    }
    return jsonError("Failed to delete site notice", 500);
  }
}
