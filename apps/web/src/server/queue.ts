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

export async function enqueueJob(input: EnqueueJobInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
    });

    if (existing) {
      return existing;
    }
  }

  return prisma.jobQueue.create({
    data: {
      userId: input.userId,
      type: input.type,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      status: JobStatus.PENDING,
      runAfter: input.runAfter ?? new Date(),
      idempotencyKey: input.idempotencyKey,
    },
  });
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
  return prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: JobStatus.SUCCEEDED,
      finishedAt: new Date(),
      result: (result ?? null) as Prisma.InputJsonValue,
    },
  });
}

export async function markJobFailed(jobId: string, errorMessage: string) {
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

export async function touchHeartbeat(workerId: string) {
  return prisma.workerHeartbeat.upsert({
    where: { workerId },
    update: { lastSeenAt: new Date() },
    create: { workerId, lastSeenAt: new Date() },
  });
}
