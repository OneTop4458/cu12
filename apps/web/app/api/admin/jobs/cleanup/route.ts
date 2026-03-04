import { NextRequest } from "next/server";
import { z } from "zod";
import { JobStatus } from "@prisma/client";
import { jsonError, jsonOk, parseBody, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

const CleanupRequestSchema = z.object({
  olderThanDays: z.number().int().min(1).max(365).default(30).optional(),
  statuses: z.array(z.nativeEnum(JobStatus)).min(1).max(5).optional(),
  userId: z.string().uuid().optional(),
});

const ALLOWED_CLEANUP_STATUSES: JobStatus[] = [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED];
const DEFAULT_CLEANUP_STATUSES = [
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELED,
] as const;

export async function POST(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  try {
    const payload = await parseBody(request, CleanupRequestSchema);
    const olderThanDays = payload.olderThanDays ?? 30;
    const statuses = payload.statuses ?? [...DEFAULT_CLEANUP_STATUSES];

    const unsupported = statuses.some((status) => !ALLOWED_CLEANUP_STATUSES.includes(status));
    if (unsupported) {
      return jsonError("Only SUCCEEDED, FAILED, CANCELED can be cleaned up", 400, "VALIDATION_ERROR");
    }

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await prisma.jobQueue.deleteMany({
      where: {
        status: { in: statuses },
        updatedAt: { lt: cutoff },
        ...(payload.userId ? { userId: payload.userId } : {}),
      },
    });

    await writeAuditLog({
      category: "JOB",
      severity: "WARN",
      actorUserId: context.actor.userId,
      message: "Admin cleaned up jobs",
      meta: {
        deleted: result.count,
        olderThanDays,
        statuses,
        userId: payload.userId ?? null,
      },
    });

    return jsonOk({
      deleted: result.count,
      olderThanDays,
      statusFilter: statuses,
      cutoff: cutoff.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400, "VALIDATION_ERROR");
    }
    return jsonError("Failed to cleanup jobs", 500);
  }
}
