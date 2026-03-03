import { AuditCategory, AuditSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface WriteAuditLogInput {
  category: AuditCategory;
  severity?: AuditSeverity;
  actorUserId?: string | null;
  targetUserId?: string | null;
  message: string;
  meta?: unknown;
}

export async function writeAuditLog(input: WriteAuditLogInput) {
  const meta =
    input.meta === undefined
      ? undefined
      : input.meta === null
        ? Prisma.JsonNull
        : (input.meta as Prisma.InputJsonValue);

  return prisma.auditLog.create({
    data: {
      category: input.category,
      severity: input.severity ?? "INFO",
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      message: input.message,
      meta,
    },
  });
}

export interface ListAuditLogInput {
  limit?: number;
  page?: number;
  skip?: number;
  category?: AuditCategory;
  severity?: AuditSeverity;
  targetUserId?: string;
}

export async function listAuditLogs(input?: ListAuditLogInput) {
  const limit = Math.min(Math.max(input?.limit ?? 100, 1), 500);
  const page = Number.isFinite(input?.page) ? Math.max(Math.trunc(input.page ?? 1), 1) : 1;
  const skip = Number.isFinite(input?.skip) ? Math.max(Math.trunc(input.skip ?? 0), 0) : (page - 1) * limit;

  return prisma.auditLog.findMany({
    where: buildAuditLogWhere(input),
    orderBy: { createdAt: "desc" },
    skip,
    take: limit,
    include: {
      actor: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
      target: {
        select: {
          id: true,
          email: true,
          role: true,
        },
      },
    },
  });
}

export async function countAuditLogs(input?: ListAuditLogInput) {
  return prisma.auditLog.count({
    where: buildAuditLogWhere(input),
  });
}

function buildAuditLogWhere(input?: ListAuditLogInput) {
  return {
    ...(input?.category ? { category: input.category } : {}),
    ...(input?.severity ? { severity: input.severity } : {}),
    ...(input?.targetUserId ? { targetUserId: input.targetUserId } : {}),
  } as const;
}

