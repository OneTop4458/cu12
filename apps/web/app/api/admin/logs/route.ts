import { AuditCategory, AuditSeverity } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
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

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const url = new URL(request.url);
  const page = Math.max(Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1, 1);
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const limit = Math.min(Math.max(Math.trunc(limitRaw) || 100, 1), 500);
  const category = parseCategory(url.searchParams.get("category"));
  const severity = parseSeverity(url.searchParams.get("severity"));

  const query = {
    category,
    severity,
    targetUserId: url.searchParams.get("targetUserId") ?? undefined,
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


