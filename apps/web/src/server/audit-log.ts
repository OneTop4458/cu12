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
  actorUserId?: string;
  targetUserQuery?: string;
  actorUserQuery?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export async function listAuditLogs(input: ListAuditLogInput | undefined = {}) {
  const safeInput: ListAuditLogInput = input ?? {};
  const limit = Math.min(Math.max(Math.trunc(safeInput.limit ?? 100), 1), 500);
  const page = Math.max(Math.trunc(safeInput.page ?? 1), 1);
  const skipInput = safeInput.skip ?? (page - 1) * limit;
  const skip = Math.max(Math.trunc(Number.isFinite(skipInput) ? skipInput : (page - 1) * limit), 0);

  return prisma.auditLog.findMany({
    where: buildAuditLogWhere(safeInput),
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
  const safeInput: ListAuditLogInput = input ?? {};
  return prisma.auditLog.count({
    where: buildAuditLogWhere(safeInput),
  });
}

function buildAuditLogWhere(input?: ListAuditLogInput) {
  const where: Prisma.AuditLogWhereInput = {};
  const and: Prisma.AuditLogWhereInput[] = [];

  if (input?.category) {
    where.category = input.category;
  }
  if (input?.severity) {
    where.severity = input.severity;
  }
  if (input?.targetUserId) {
    where.targetUserId = input.targetUserId;
  }
  if (input?.actorUserId) {
    where.actorUserId = input.actorUserId;
  }
  if (input?.targetUserQuery?.trim()) {
    const query = input.targetUserQuery.trim();
    and.push({
      OR: [
        { targetUserId: query },
        { target: { is: { email: query } } },
        { target: { is: { cu12Account: { is: { cu12Id: query } } } } },
        { target: { is: { name: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  if (input?.actorUserQuery?.trim()) {
    const query = input.actorUserQuery.trim();
    and.push({
      OR: [
        { actorUserId: query },
        { actor: { is: { email: query } } },
        { actor: { is: { cu12Account: { is: { cu12Id: query } } } } },
        { actor: { is: { name: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  if (input?.createdAfter || input?.createdBefore) {
    where.createdAt = {};
    if (input.createdAfter) {
      where.createdAt.gte = input.createdAfter;
    }
    if (input.createdBefore) {
      where.createdAt.lte = input.createdBefore;
    }
  }
  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}

