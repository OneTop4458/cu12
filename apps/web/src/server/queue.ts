import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { QueuePayload } from "@cu12/core";
import { MANUAL_PENDING_REDISPATCH_MS, MANUAL_RUNNING_REDISPATCH_MS } from "@/server/manual-dispatch-policy";

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

export type SyncQueueState = "IDLE" | "RUNNING" | "RUNNING_STALE" | "PENDING" | "PENDING_STALE";

export interface SyncQueueSummary {
  state: SyncQueueState;
  staleJobIds: string[];
  runningCount: number;
  runningStaleCount: number;
  pendingCount: number;
  pendingStaleCount: number;
}

const STALE_WORKER_TIMEOUT_MS = 3 * 60 * 1000;

const STALE_JOB_REQUEUE_DELAY_MS = 60_000;
const AUTOLEARN_CONFLICT_DELAY_MS = 60_000;
const CLAIM_SCAN_LIMIT = 200;

function rankJobTypes(inputTypes: JobType[]): JobType[] {
  const uniqueTypes = Array.from(new Set(inputTypes));
  const priority: JobType[] = [
    JobType.SYNC,
    JobType.NOTICE_SCAN,
    JobType.AUTOLEARN,
    JobType.MAIL_DIGEST,
  ];

  const ordered: JobType[] = [];
  for (const type of priority) {
    if (uniqueTypes.includes(type)) {
      ordered.push(type);
    }
  }

  for (const type of uniqueTypes) {
    if (!ordered.includes(type)) {
      ordered.push(type);
    }
  }

  return ordered;
}

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
  if (types.length === 0) return null;

  const requestTypes = rankJobTypes(types);
  const now = new Date();

  const candidates = await prisma.jobQueue.findMany({
    where: {
      type: { in: requestTypes },
      status: JobStatus.PENDING,
      runAfter: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: CLAIM_SCAN_LIMIT,
  });

  if (candidates.length === 0) {
    return null;
  }

  const requestTypeRank = new Map<JobType, number>();
  requestTypes.forEach((type, index) => {
    requestTypeRank.set(type, index);
  });

  const sortedCandidates = candidates.slice().sort((left, right) => {
    const leftRank = requestTypeRank.get(left.type) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = requestTypeRank.get(right.type) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  for (const candidate of sortedCandidates) {
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
      continue;
    }

    if (candidate.type === JobType.AUTOLEARN) {
      const runningAutoLearnByUser = await prisma.jobQueue.count({
        where: {
          userId: candidate.userId,
          type: JobType.AUTOLEARN,
          status: JobStatus.RUNNING,
          id: { not: candidate.id },
        },
      });

      if (runningAutoLearnByUser > 0) {
        await prisma.jobQueue.update({
          where: { id: candidate.id },
          data: {
            status: JobStatus.PENDING,
            startedAt: null,
            workerId: null,
            runAfter: new Date(Date.now() + AUTOLEARN_CONFLICT_DELAY_MS),
          },
        });
        continue;
      }
    }

    return prisma.jobQueue.findUnique({ where: { id: candidate.id } });
  }

  return null;
}

export async function getSyncQueueSummaryForUser(userId: string, now = new Date()): Promise<SyncQueueSummary> {
  const rows = await prisma.jobQueue.findMany({
    where: {
      userId,
      type: { in: [JobType.SYNC, JobType.NOTICE_SCAN] },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: {
      id: true,
      status: true,
      runAfter: true,
      createdAt: true,
      startedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let runningCount = 0;
  let runningFresh = false;
  let runningStaleCount = 0;
  let pendingCount = 0;
  let pendingFresh = false;
  let pendingStaleCount = 0;
  const staleJobIds: string[] = [];

  for (const row of rows) {
    if (row.status === JobStatus.RUNNING) {
      const isRunningStale = !row.startedAt
        || now.getTime() - row.startedAt.getTime() >= MANUAL_RUNNING_REDISPATCH_MS;

      if (isRunningStale) {
        runningStaleCount += 1;
        staleJobIds.push(row.id);
      } else {
        runningFresh = true;
      }

      runningCount += 1;
      continue;
    }

    const pendingAnchor = row.runAfter ?? row.createdAt;
    const isPendingStale = now.getTime() - pendingAnchor.getTime() >= MANUAL_PENDING_REDISPATCH_MS;

    if (isPendingStale) {
      pendingStaleCount += 1;
      staleJobIds.push(row.id);
    } else {
      pendingFresh = true;
    }

    pendingCount += 1;
  }

  if (runningFresh) {
    return {
      state: "RUNNING",
      staleJobIds: [],
      runningCount,
      runningStaleCount,
      pendingCount,
      pendingStaleCount,
    };
  }

  if (pendingFresh) {
    return {
      state: runningStaleCount > 0 ? "RUNNING_STALE" : "PENDING",
      staleJobIds,
      runningCount,
      runningStaleCount,
      pendingCount,
      pendingStaleCount,
    };
  }

  if (runningStaleCount > 0) {
    return {
      state: "RUNNING_STALE",
      staleJobIds,
      runningCount,
      runningStaleCount,
      pendingCount,
      pendingStaleCount,
    };
  }

  if (pendingStaleCount > 0) {
    return {
      state: "PENDING_STALE",
      staleJobIds,
      runningCount,
      runningStaleCount,
      pendingCount,
      pendingStaleCount,
    };
  }

  return {
    state: "IDLE",
    staleJobIds: [],
    runningCount,
    runningStaleCount,
    pendingCount,
    pendingStaleCount,
  };
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

export async function cancelJob(jobId: string): Promise<{
  job: {
    id: string;
    userId: string;
    type: JobType;
    status: JobStatus;
    workerId: string | null;
    updatedAt: Date;
  };
  updated: boolean;
}> {
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
    const existing = await prisma.jobQueue.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        workerId: true,
        updatedAt: true,
      },
    });
    if (!existing) {
      throw new Error("Job not found");
    }
    return { job: existing, updated: false };
  }

  const job = await prisma.jobQueue.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      workerId: true,
      updatedAt: true,
    },
  });
  return { job, updated: true };
}

export async function retryJob(jobId: string, options: { allowCompleted?: boolean } = {}) {
  const existing = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      userId: true,
      id: true,
    },
  });

  if (!existing) {
    throw new Error("Job not found");
  }

  if (existing.status === JobStatus.RUNNING) {
    throw new Error("Cannot retry running job");
  }

  if (existing.status === JobStatus.SUCCEEDED && !options.allowCompleted) {
    throw new Error("Completed job requires force retry");
  }

  if (existing.status === JobStatus.PENDING) {
    return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  }

  return prisma.jobQueue.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PENDING,
      startedAt: null,
      workerId: null,
      finishedAt: null,
      runAfter: new Date(),
      lastError: null,
      result: Prisma.JsonNull,
    },
  });
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
