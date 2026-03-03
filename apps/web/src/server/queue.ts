import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { QueuePayload } from "@cu12/core";

export interface EnqueueJobInput {
  userId: string;
  type: JobType;
  payload: QueuePayload;
  idempotencyKey?: string;
  runAfter?: Date;
}

export interface EnqueueJobResult {
  job: {
    id: string;
    userId: string;
    type: JobType;
    status: JobStatus;
    payload: Prisma.JsonValue;
    result: Prisma.JsonValue | null;
    idempotencyKey: string | null;
    attempts: number;
    runAfter: Date;
    workerId: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  deduplicated: boolean;
}

const STALE_WORKER_TIMEOUT_MS = 3 * 60 * 1000;

const STALE_JOB_REQUEUE_DELAY_MS = 60_000;

async function reclaimStaleRunningJobs(now = new Date()): Promise<number> {
  const heartbeatCutoff = new Date(now.getTime() - STALE_WORKER_TIMEOUT_MS);
  const staleWorkers = await prisma.workerHeartbeat.findMany({
    where: {
      lastSeenAt: { lt: heartbeatCutoff },
    },
    select: { workerId: true },
  });

  if (staleWorkers.length === 0) {
    return 0;
  }

  const workerIds = Array.from(new Set(staleWorkers.map((item) => item.workerId)));
  const result = await prisma.jobQueue.updateMany({
    where: {
      status: JobStatus.RUNNING,
      workerId: { in: workerIds },
    },
    data: {
      status: JobStatus.PENDING,
      startedAt: null,
      workerId: null,
      runAfter: new Date(Date.now() + STALE_JOB_REQUEUE_DELAY_MS),
      lastError: "WORKER_STALE_TIMEOUT",
    },
  });

  return result.count;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
  if (input.idempotencyKey) {
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
    });

    if (existing) {
      return { job: existing, deduplicated: true };
    }
  }

  const created = await prisma.jobQueue.create({
    data: {
      userId: input.userId,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      status: JobStatus.PENDING,
      runAfter: input.runAfter ?? new Date(),
      idempotencyKey: input.idempotencyKey,
    },
  });

  return { job: created, deduplicated: false };
}

export async function listJobsForUser(userId: string, limit = 20, type?: JobType, status?: JobStatus) {
  return prisma.jobQueue.findMany({
    where: {
      userId,
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getJobForUser(jobId: string, userId: string) {
  return prisma.jobQueue.findFirst({
    where: { id: jobId, userId },
  });
}

export async function claimNextJob(workerId: string, types: JobType[]) {
  await reclaimStaleRunningJobs();

  const candidate = await prisma.jobQueue.findFirst({
    where: {
      type: { in: types },
      status: JobStatus.PENDING,
      runAfter: { lte: new Date() },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  if (!candidate) return null;

  const claimed = await prisma.jobQueue.updateMany({
    where: {
      id: candidate.id,
      status: JobStatus.PENDING,
    },
    data: {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
      attempts: { increment: 1 },
      workerId,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return null;
  }

  const runningBySameUser = await prisma.jobQueue.count({
    where: {
      userId: candidate.userId,
      status: JobStatus.RUNNING,
      id: { not: candidate.id },
    },
  });

  if (runningBySameUser > 0) {
    await prisma.jobQueue.update({
      where: { id: candidate.id },
      data: {
        status: JobStatus.PENDING,
        startedAt: null,
        workerId: null,
        runAfter: new Date(Date.now() + 60_000),
      },
    });
    return null;
  }

  return prisma.jobQueue.findUnique({ where: { id: candidate.id } });
}

export async function markJobSucceeded(jobId: string, result?: unknown) {
  const updatedCount = await prisma.jobQueue.updateMany({
    where: {
      id: jobId,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    data: {
      status: JobStatus.SUCCEEDED,
      finishedAt: new Date(),
      result: (result ?? null) as Prisma.InputJsonValue,
    },
  });

  if (updatedCount.count === 0) {
    return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  }

  return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
}

export async function updateJobProgress(jobId: string, result: unknown) {
  const current = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true },
  });

  if (!current) {
    throw new Error("Job not found");
  }

  if (
    current.status === JobStatus.SUCCEEDED
    || current.status === JobStatus.FAILED
    || current.status === JobStatus.CANCELED
  ) {
    return null;
  }

  return prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      result: result as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
}

export async function markJobFailed(jobId: string, errorMessage: string) {
  const current = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true, userId: true, type: true, payload: true, attempts: true, idempotencyKey: true },
  });

  if (!current) {
    throw new Error("Job not found");
  }

  if (
    current.status === JobStatus.SUCCEEDED
    || current.status === JobStatus.CANCELED
    || current.status === JobStatus.FAILED
  ) {
    return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  }

  const updated = await prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      lastError: errorMessage,
    },
  });

  if (updated.attempts < 4) {
    const delayMinutes = [1, 5, 15, 60][Math.max(0, updated.attempts - 1)] ?? 60;
    await prisma.jobQueue.create({
      data: {
        userId: updated.userId,
        type: updated.type,
        payload: updated.payload as unknown as Prisma.InputJsonValue,
        status: JobStatus.PENDING,
        runAfter: new Date(Date.now() + delayMinutes * 60_000),
        idempotencyKey: updated.idempotencyKey,
      },
    });
  }

  return updated;
}

export async function cancelJob(jobId: string) {
  const updated = await prisma.jobQueue.updateMany({
    where: {
      id: jobId,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    data: {
      status: JobStatus.CANCELED,
      startedAt: null,
      workerId: null,
      finishedAt: new Date(),
      lastError: "CANCELLED_BY_USER",
    },
  });

  if (updated.count === 0) {
    const existing = await prisma.jobQueue.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new Error("Job not found");
    }
    return existing;
  }

  return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
}

export async function getJobStatus(jobId: string) {
  return prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
}

export async function touchHeartbeat(workerId: string) {
  return prisma.workerHeartbeat.upsert({
    where: { workerId },
    update: { lastSeenAt: new Date() },
    create: { workerId, lastSeenAt: new Date() },
  });
}
