import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { cancelJob } from "@/server/queue";
import { writeAuditLog } from "@/server/audit-log";

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const { jobId } = await params;

  const existing = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!existing) {
    return jsonError("Job not found", 404);
  }

  try {
    const job = await cancelJob(jobId);
    await writeAuditLog({
      category: "JOB",
      severity: "WARN",
      actorUserId: context.actor.userId,
      targetUserId: existing.userId,
      message: "Admin cancelled job",
      meta: {
        jobId,
        userId: existing.userId,
        userEmail: existing.user?.email,
      },
    });

    return jsonOk({
      updated: true,
      status: job.status,
      jobId,
      userId: existing.userId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Job not found") {
      return jsonError("Job not found", 404);
    }
    return jsonError("Failed to cancel job", 500);
  }
}

