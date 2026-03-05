import { NextRequest } from "next/server";
import { z } from "zod";
import { JobStatus } from "@prisma/client";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

const FULL_CLEANUP_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.RUNNING,
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELED,
];

const SAFE_CLEANUP_STATUSES: JobStatus[] = [
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELED,
];

const CLEANUP_CONFIRM_CODE = "RESET_ALL_JOBS";

const CleanupRequestSchema = z.object({
  olderThanDays: z.number().int().min(1).max(3650).default(30).optional(),
  statuses: z.array(z.nativeEnum(JobStatus)).min(1).max(5).optional(),
  scope: z.enum(["safe", "full"]).default("safe"),
  userId: z.string().uuid().optional(),
  confirmCode: z.string().optional(),
  dryRun: z.boolean().default(false).optional(),
});

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const payload = await parseBody(request, CleanupRequestSchema);
    const olderThanDays = payload.olderThanDays ?? 30;
    const scope = payload.scope ?? "safe";
    const statuses = payload.statuses ?? (scope === "full" ? [...FULL_CLEANUP_STATUSES] : [...SAFE_CLEANUP_STATUSES]);
    const needsConfirmation = scope === "full";

    if (scope === "safe" && statuses.some((status) => !SAFE_CLEANUP_STATUSES.includes(status))) {
      return jsonError("Safe cleanup only supports SUCCEEDED, FAILED, and CANCELED", 400, "VALIDATION_ERROR");
    }

    if (needsConfirmation && payload.confirmCode !== CLEANUP_CONFIRM_CODE) {
      return jsonError(
        `Confirmation code required when cleaning PENDING/RUNNING in full scope. Use code: ${CLEANUP_CONFIRM_CODE}`,
        400,
        "CONFIRMATION_REQUIRED",
      );
    }

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const whereClause = {
      status: { in: statuses },
      updatedAt: { lt: cutoff },
      ...(payload.userId ? { userId: payload.userId } : {}),
    };
    const grouped = await prisma.jobQueue.groupBy({
      where: {
        ...whereClause,
      },
      by: ["status"],
      _count: { _all: true },
    });

    const deletedByStatus = Object.fromEntries(
      Object.values(JobStatus).map((status) => [status, 0]),
    ) as Record<JobStatus, number>;
    for (const row of grouped) {
      deletedByStatus[row.status] = row._count._all;
    }

    const deletedCount = await (payload.dryRun
      ? Promise.resolve(0)
      : prisma.jobQueue.deleteMany({
          where: whereClause,
        }).then((result) => result.count));

    await writeAuditLog({
      category: "JOB",
      severity: payload.dryRun ? "INFO" : "WARN",
      actorUserId: context.actor.userId,
      message: payload.dryRun ? "Admin dry-run job cleanup requested" : "Admin cleaned up jobs",
      meta: {
        deleted: deletedCount,
        olderThanDays,
        statuses,
        scope,
        dryRun: payload.dryRun,
        userId: payload.userId ?? null,
        confirmCode: payload.dryRun ? undefined : payload.confirmCode,
      },
    });

    return jsonOk({
      deleted: deletedCount,
      deletedByStatus,
      scope,
      olderThanDays,
      statusFilter: statuses,
      dryRun: payload.dryRun ?? false,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to cleanup jobs", 500);
  }
}
