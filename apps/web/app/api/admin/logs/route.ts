import { AuditCategory, AuditSeverity } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { countAuditLogs, listAuditLogs } from "@/server/audit-log";

function parseCategory(raw: string | null): AuditCategory | undefined {
  if (!raw) return undefined;
  if (Object.values(AuditCategory).includes(raw as AuditCategory)) {
    return raw as AuditCategory;
  }
  return undefined;
}

function parseSeverity(raw: string | null): AuditSeverity | undefined {
  if (!raw) return undefined;
  if (Object.values(AuditSeverity).includes(raw as AuditSeverity)) {
    return raw as AuditSeverity;
  }
  return undefined;
}

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const url = new URL(request.url);
  const page = Math.max(Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1, 1);
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Math.min(Math.max(Math.trunc(limitRaw) || 100, 1), 500);
  const category = parseCategory(url.searchParams.get("category"));
  const severity = parseSeverity(url.searchParams.get("severity"));
  const actorUserId = url.searchParams.get("actorUserId") ?? undefined;
  const actorUserQuery = url.searchParams.get("actorQuery") ?? undefined;
  const createdAfter = parseDate(url.searchParams.get("from"));
  const createdBefore = parseDate(url.searchParams.get("to"));
  if (url.searchParams.get("from") && !createdAfter) {
    return jsonError("Invalid from date", 400, "VALIDATION_ERROR");
  }
  if (url.searchParams.get("to") && !createdBefore) {
    return jsonError("Invalid to date", 400, "VALIDATION_ERROR");
  }
  if (createdAfter && createdBefore && createdAfter.getTime() > createdBefore.getTime()) {
    return jsonError("from must be earlier than to", 400, "VALIDATION_ERROR");
  }

  const query = {
    category,
    severity,
    targetUserId: url.searchParams.get("targetUserId") ?? undefined,
    actorUserId,
    targetUserQuery: url.searchParams.get("targetQuery") ?? undefined,
    actorUserQuery,
    createdAfter,
    createdBefore,
  };

  const total = await countAuditLogs(query);
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const currentPage = Math.min(page, totalPages);

  const logs = await listAuditLogs({
    ...query,
    page: currentPage,
    limit,
  });

  return jsonOk({
    logs,
    pagination: {
      page: currentPage,
      limit,
      total,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.auditLog.deleteMany({});
      const retained = await tx.auditLog.create({
        data: {
          category: "ADMIN",
          severity: "WARN",
          actorUserId: context.actor.userId,
          targetUserId: null,
          message: "Admin purged audit logs",
          meta: {
            deleted: deleted.count,
          },
        },
      });

      return {
        deleted: deleted.count,
        retainedLogId: retained.id,
      };
    });

    return jsonOk({
      deleted: result.deleted,
      retained: 1,
      retainedLogId: result.retainedLogId,
    });
  } catch {
    return jsonError("Failed to purge audit logs", 500);
  }
}


