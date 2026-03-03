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
  category?: AuditCategory;
  severity?: AuditSeverity;
  targetUserId?: string;
}

export async function listAuditLogs(input?: ListAuditLogInput) {
  return prisma.auditLog.findMany({
    where: {
      ...(input?.category ? { category: input.category } : {}),
      ...(input?.severity ? { severity: input.severity } : {}),
      ...(input?.targetUserId ? { targetUserId: input.targetUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(input?.limit ?? 100, 1), 500),
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

