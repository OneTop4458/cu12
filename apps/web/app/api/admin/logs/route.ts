import { AuditCategory, AuditSeverity } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { listAuditLogs } from "@/server/audit-log";

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
  const limitRaw = Number(url.searchParams.get("limit") ?? 100);
  const logs = await listAuditLogs({
    limit: limitRaw,
    category: parseCategory(url.searchParams.get("category")),
    severity: parseSeverity(url.searchParams.get("severity")),
    targetUserId: url.searchParams.get("targetUserId") ?? undefined,
  });

  return jsonOk({ logs });
}


