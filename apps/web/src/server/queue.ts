import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
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
const SYNC_JOB_TYPES = [JobType.SYNC, JobType.NOTICE_SCAN] as const;
const AUTOLEARN_MODES = ["SINGLE_NEXT", "SINGLE_ALL", "ALL_COURSES"] as const;

export const TEST_USER_SYNC_BLOCKED_ERROR_CODE = "TEST_USER_SYNC_BLOCKED";
export const TEST_USER_SYNC_BLOCKED_MESSAGE = "Test users do not support CU12 sync.";

interface AutoLearnResultLike {
  mode?: unknown;
  watchedSeconds?: unknown;
  truncated?: unknown;
  continuationQueued?: unknown;
  chainLimitReached?: unknown;
  chainSegment?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeAutoLearnMode(value: unknown): QueuePayload["autoLearnMode"] | null {
  if (typeof value !== "string") return null;
  if ((AUTOLEARN_MODES as readonly string[]).includes(value)) {
    return value as QueuePayload["autoLearnMode"];
  }
  return null;
}

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

export async function ensureSyncAllowedForUser(userId: string): Promise<{
  allowed: boolean;
  canceledCount: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isTestUser: true },
  });

  if (!user?.isTestUser) {
    return { allowed: true, canceledCount: 0 };
  }

  const canceledCount = await cancelBlockedSyncJobsForTestUsers(userId);
  return { allowed: false, canceledCount };
}

export async function cancelBlockedSyncJobsForTestUsers(userId?: string): Promise<number> {
  const canceled = await prisma.jobQueue.updateMany({
    where: {
      ...(userId ? { userId } : {}),
      type: { in: [...SYNC_JOB_TYPES] },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      user: {
        is: {
          isTestUser: true,
        },
      },
    },
    data: {
      status: JobStatus.CANCELED,
      startedAt: null,
      workerId: null,
      finishedAt: new Date(),
      lastError: TEST_USER_SYNC_BLOCKED_ERROR_CODE,
    },
  });

  return canceled.count;
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
  if (types.includes(JobType.SYNC) || types.includes(JobType.NOTICE_SCAN)) {
    await cancelBlockedSyncJobsForTestUsers();
  }
  await reclaimStaleRunningJobs();
  if (types.length === 0) return null;

  const requestTypes = rankJobTypes(types);
  const now = new Date();

  for (const requestType of requestTypes) {
    const candidates = await prisma.jobQueue.findMany({
      where: {
        type: requestType,
        status: JobStatus.PENDING,
        runAfter: { lte: now },
      },
      orderBy: { createdAt: "asc" },
      take: CLAIM_SCAN_LIMIT,
    });

    for (const candidate of candidates) {
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
              runAfter: new Date(now.getTime() + AUTOLEARN_CONFLICT_DELAY_MS),
            },
          });
          continue;
        }
      }

      return prisma.jobQueue.findUnique({ where: { id: candidate.id } });
    }
  }

  return null;
}

export async function hasPendingJobs(types: JobType[]): Promise<boolean> {
  if (types.length === 0) return false;
  const uniqueTypes = Array.from(new Set(types));
  const count = await prisma.jobQueue.count({
    where: {
      type: { in: uniqueTypes },
      status: JobStatus.PENDING,
    },
  });
  return count > 0;
}

export async function getSyncQueueSummaryForUser(userId: string, now = new Date()): Promise<SyncQueueSummary> {
  const rows = await prisma.jobQueue.findMany({
    where: {
      userId,
      type: { in: [...SYNC_JOB_TYPES] },
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: {
      id: true,
      status: true,
      runAfter: true,
      createdAt: true,
      startedAt: true,
      workerId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const runningWorkerIds = Array.from(
    new Set(
      rows
        .filter((row) => row.status === JobStatus.RUNNING && typeof row.workerId === "string" && row.workerId.length > 0)
        .map((row) => row.workerId as string),
    ),
  );
  const heartbeats = runningWorkerIds.length === 0
    ? []
    : await prisma.workerHeartbeat.findMany({
      where: {
        workerId: { in: runningWorkerIds },
      },
      select: {
        workerId: true,
        lastSeenAt: true,
      },
    });
  const heartbeatByWorkerId = new Map(heartbeats.map((row) => [row.workerId, row.lastSeenAt]));
  const workerHeartbeatCutoffMs = now.getTime() - STALE_WORKER_TIMEOUT_MS;

  let runningCount = 0;
  let runningFresh = false;
  let runningStaleCount = 0;
  let pendingCount = 0;
  let pendingFresh = false;
  let pendingStaleCount = 0;
  const staleJobIds: string[] = [];

  for (const row of rows) {
    if (row.status === JobStatus.RUNNING) {
      const startedAtStale = !row.startedAt
        || now.getTime() - row.startedAt.getTime() >= MANUAL_RUNNING_REDISPATCH_MS;
      const heartbeatAt = row.workerId ? heartbeatByWorkerId.get(row.workerId) : null;
      const heartbeatStale = !heartbeatAt || heartbeatAt.getTime() < workerHeartbeatCutoffMs;
      const isRunningStale = startedAtStale && heartbeatStale;

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

export async function markJobSucceeded(jobId: string, workerId: string, result?: unknown) {
  const env = getEnv();
  const chainMaxSeconds = env.AUTOLEARN_CHAIN_MAX_SECONDS;

  const txResult = await prisma.$transaction(async (tx) => {
    const current = await tx.jobQueue.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        userId: true,
        status: true,
        workerId: true,
        type: true,
        payload: true,
      },
    });

    if (!current) {
      return { state: "MISSING" as const };
    }

    if (current.workerId !== workerId) {
      return { state: "OWNERSHIP_MISMATCH" as const };
    }

    if (current.status !== JobStatus.RUNNING) {
      const existing = await tx.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
      return { state: "ALREADY_TERMINAL" as const, job: existing };
    }

    let resultForStore = (result ?? null) as Prisma.InputJsonValue;
    let continuationPayload: Prisma.InputJsonValue | null = null;
    let continuationKey: string | null = null;

    if (current.type === JobType.AUTOLEARN && isRecord(result)) {
      const payload = isRecord(current.payload) ? (current.payload as unknown as QueuePayload) : null;
      const resultPatch: Record<string, unknown> = { ...(result as AutoLearnResultLike) };
      const chainSegment = Math.max(1, toSafeInt(payload?.chainSegment, 1));
      const previousElapsed = toSafeInt(payload?.chainElapsedSeconds, 0);
      const watchedSeconds = toSafeInt(resultPatch.watchedSeconds, 0);
      const totalElapsed = previousElapsed + watchedSeconds;
      const truncated = resultPatch.truncated === true;
      const chainLimitReached = truncated && totalElapsed >= chainMaxSeconds;

      resultPatch.chainSegment = chainSegment;
      resultPatch.chainLimitReached = chainLimitReached;
      resultPatch.continuationQueued = false;

      if (truncated && !chainLimitReached && payload && typeof payload.userId === "string" && payload.userId.length > 0) {
        const mode = normalizeAutoLearnMode(payload.autoLearnMode)
          ?? normalizeAutoLearnMode(resultPatch.mode)
          ?? "ALL_COURSES";
        const lectureSeq = typeof payload.lectureSeq === "number" && Number.isFinite(payload.lectureSeq)
          ? payload.lectureSeq
          : undefined;
        const nextSegment = chainSegment + 1;
        const lecturePart = typeof lectureSeq === "number" ? String(lectureSeq) : "all";
        continuationKey = `autolearn-chain:${current.userId}:${mode}:${lecturePart}:${nextSegment}`;
        continuationPayload = {
          ...(payload ?? { userId: current.userId }),
          userId: current.userId,
          autoLearnMode: mode,
          lectureSeq,
          reason: "auto_continuation",
          chainSegment: nextSegment,
          chainElapsedSeconds: totalElapsed,
        } as Prisma.InputJsonValue;

        resultPatch.continuationQueued = true;
      }

      resultForStore = resultPatch as Prisma.InputJsonValue;
    }

    const updatedCount = await tx.jobQueue.updateMany({
      where: {
        id: jobId,
        status: JobStatus.RUNNING,
        workerId,
      },
      data: {
        status: JobStatus.SUCCEEDED,
        finishedAt: new Date(),
        result: resultForStore,
      },
    });

    if (updatedCount.count === 0) {
      throw new Error("Failed to mark job as succeeded");
    }

    if (continuationPayload && continuationKey) {
      await tx.jobQueue.create({
        data: {
          userId: current.userId,
          type: JobType.AUTOLEARN,
          status: JobStatus.PENDING,
          payload: continuationPayload,
          runAfter: new Date(),
          idempotencyKey: continuationKey,
        },
      });
    }

    const updated = await tx.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
    return { state: "UPDATED" as const, job: updated };
  });

  if (txResult.state === "MISSING") {
    throw new Error("Job not found");
  }

  if (txResult.state === "OWNERSHIP_MISMATCH") {
    throw new Error("Job ownership mismatch");
  }

  return txResult.job;
}

export async function updateJobProgress(jobId: string, workerId: string, result: unknown) {
  const current = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true, workerId: true },
  });

  if (!current) {
    throw new Error("Job not found");
  }

  if (current.workerId !== workerId) {
    throw new Error("Job ownership mismatch");
  }

  if (current.status !== JobStatus.RUNNING) {
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

export async function markJobFailed(jobId: string, workerId: string, errorMessage: string) {
  const current = await prisma.jobQueue.findUnique({
    where: { id: jobId },
    select: { status: true, workerId: true, userId: true, type: true, payload: true, attempts: true, idempotencyKey: true },
  });

  if (!current) {
    throw new Error("Job not found");
  }

  if (current.workerId !== workerId) {
    throw new Error("Job ownership mismatch");
  }

  if (
    current.status === JobStatus.SUCCEEDED
    || current.status === JobStatus.CANCELED
    || current.status === JobStatus.FAILED
  ) {
    return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  }

  const failed = await prisma.jobQueue.updateMany({
    where: {
      id: jobId,
      status: JobStatus.RUNNING,
      workerId,
    },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      lastError: errorMessage,
    },
  });
  if (failed.count === 0) {
    return prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  }

  const updated = await prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });

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
