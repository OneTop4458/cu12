import type { PortalProvider } from "@cu12/core";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import {
  isMissingWorkerHeartbeatStoreError,
  warnMissingWorkerHeartbeatStore,
} from "@/lib/worker-heartbeat-compat";
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

export interface PendingJobsSummary {
  pending: boolean;
  eligiblePending: boolean;
  futurePending: boolean;
  nextRunAfter: Date | null;
}

export interface RetryJobSummary {
  id: string;
  userId: string;
  type: JobType;
  runAfter: Date;
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
const NON_RETRYABLE_AUTOLEARN_ERRORS = new Set([
  "ACCOUNT_REAUTH_REQUIRED",
  "CYBER_CAMPUS_SECONDARY_AUTH_REQUIRED",
  "CYBER_CAMPUS_SESSION_INVALID",
  "CYBER_CAMPUS_SESSION_REQUIRED",
]);

export const TEST_USER_SYNC_BLOCKED_ERROR_CODE = "TEST_USER_SYNC_BLOCKED";
export const TEST_USER_SYNC_BLOCKED_MESSAGE = "Test users do not support CU12 sync.";

interface AutoLearnResultLike {
  mode?: unknown;
  elapsedSeconds?: unknown;
  watchedSeconds?: unknown;
  truncated?: unknown;
  continuationQueued?: unknown;
  chainLimitReached?: unknown;
  chainSegment?: unknown;
  limitReached?: unknown;
  remainingTaskCount?: unknown;
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

export function shouldQueueAutoLearnContinuation(input: {
  provider?: QueuePayload["provider"];
  truncated: boolean;
  chainLimitReached: boolean;
}): boolean {
  if (input.provider === "CYBER_CAMPUS") {
    return false;
  }

  return input.truncated && !input.chainLimitReached;
}

export function getQueuePayloadProvider(payload: Prisma.JsonValue | null): PortalProvider | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const provider = (payload as Record<string, unknown>).provider;
  return provider === "CYBER_CAMPUS" ? "CYBER_CAMPUS" : provider === "CU12" ? "CU12" : null;
}

export function shouldRetryFailedJob(
  type: JobType,
  attempts: number,
  errorMessage: string,
  options: { provider?: PortalProvider | null } = {},
): boolean {
  if (attempts >= 4) {
    return false;
  }

  if (type === JobType.AUTOLEARN && options.provider === "CYBER_CAMPUS") {
    return false;
  }

  if (type === JobType.AUTOLEARN && NON_RETRYABLE_AUTOLEARN_ERRORS.has(errorMessage)) {
    return false;
  }

  return true;
}

export type StaleRunningJobReclaimAction = "REQUEUE" | "MARK_FAILED";

export function decideStaleRunningJobReclaim(input: {
  type: JobType;
  payload: Prisma.JsonValue | null;
}): StaleRunningJobReclaimAction {
  if (
    input.type === JobType.AUTOLEARN
    && getQueuePayloadProvider(input.payload) === "CYBER_CAMPUS"
  ) {
    return "MARK_FAILED";
  }

  return "REQUEUE";
}

export function getFailedJobRetryDelayMinutes(attempts: number): number {
  return [1, 5, 15, 60][Math.max(0, attempts - 1)] ?? 60;
}

export function summarizePendingJobRows(
  rows: Array<{ runAfter: Date; createdAt: Date }>,
  now = new Date(),
): PendingJobsSummary {
  let eligiblePending = false;
  let futurePending = false;
  let nextRunAfter: Date | null = null;

  for (const row of rows) {
    const runAfter = row.runAfter ?? row.createdAt;
    if (runAfter.getTime() <= now.getTime()) {
      eligiblePending = true;
      continue;
    }

    futurePending = true;
    if (!nextRunAfter || runAfter.getTime() < nextRunAfter.getTime()) {
      nextRunAfter = runAfter;
    }
  }

  return {
    pending: rows.length > 0,
    eligiblePending,
    futurePending,
    nextRunAfter,
  };
}

async function loadHeartbeatByWorkerId(workerIds: string[]): Promise<Map<string, Date>> {
  if (workerIds.length === 0) {
    return new Map();
  }

  try {
    const heartbeats = await prisma.workerHeartbeat.findMany({
      where: {
        workerId: { in: workerIds },
      },
      select: {
        workerId: true,
        lastSeenAt: true,
      },
    });
    return new Map(heartbeats.map((row) => [row.workerId, row.lastSeenAt]));
  } catch (error) {
    if (!isMissingWorkerHeartbeatStoreError(error)) {
      throw error;
    }
    warnMissingWorkerHeartbeatStore();
    return new Map();
  }
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
  let staleWorkers: Array<{ workerId: string }> = [];
  try {
    staleWorkers = await prisma.workerHeartbeat.findMany({
      where: {
        lastSeenAt: { lt: heartbeatCutoff },
      },
      select: { workerId: true },
    });
  } catch (error) {
    if (!isMissingWorkerHeartbeatStoreError(error)) {
      throw error;
    }
    warnMissingWorkerHeartbeatStore();
    return 0;
  }

  if (staleWorkers.length === 0) {
    return 0;
  }

  const workerIds = Array.from(new Set(staleWorkers.map((item) => item.workerId)));
  let reclaimed = 0;

  while (true) {
    const staleJobs = await prisma.jobQueue.findMany({
      where: {
        status: JobStatus.RUNNING,
        workerId: { in: workerIds },
      },
      select: {
        id: true,
        type: true,
        payload: true,
        workerId: true,
      },
      orderBy: { createdAt: "asc" },
      take: CLAIM_SCAN_LIMIT,
    });

    if (staleJobs.length === 0) {
      return reclaimed;
    }

    for (const job of staleJobs) {
      const action = decideStaleRunningJobReclaim({
        type: job.type,
        payload: job.payload,
      });
      const result = await prisma.jobQueue.updateMany({
        where: {
          id: job.id,
          status: JobStatus.RUNNING,
          workerId: job.workerId,
        },
        data: action === "MARK_FAILED"
          ? {
            status: JobStatus.FAILED,
            finishedAt: now,
            lastError: "WORKER_STALE_TIMEOUT",
          }
          : {
            status: JobStatus.PENDING,
            startedAt: null,
            workerId: null,
            runAfter: new Date(now.getTime() + STALE_JOB_REQUEUE_DELAY_MS),
            lastError: "WORKER_STALE_TIMEOUT",
          },
      });
      reclaimed += result.count;
    }
  }
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

export async function claimNextJob(workerId: string, types: JobType[], userId?: string) {
  if (types.includes(JobType.SYNC) || types.includes(JobType.NOTICE_SCAN)) {
    await cancelBlockedSyncJobsForTestUsers(userId);
  }
  await reclaimStaleRunningJobs();
  if (types.length === 0) return null;

  const requestTypes = rankJobTypes(types);
  const now = new Date();

  for (const requestType of requestTypes) {
    const candidates = await prisma.jobQueue.findMany({
      where: {
        ...(userId ? { userId } : {}),
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

export async function getPendingJobsSummary(types: JobType[], userId?: string, now = new Date()): Promise<PendingJobsSummary> {
  if (types.length === 0) {
    return {
      pending: false,
      eligiblePending: false,
      futurePending: false,
      nextRunAfter: null,
    };
  }
  const uniqueTypes = Array.from(new Set(types));
  const rows = await prisma.jobQueue.findMany({
    where: {
      ...(userId ? { userId } : {}),
      type: { in: uniqueTypes },
      status: JobStatus.PENDING,
    },
    orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
    select: {
      runAfter: true,
      createdAt: true,
    },
  });
  return summarizePendingJobRows(rows, now);
}

export async function hasPendingJobs(types: JobType[], userId?: string): Promise<boolean> {
  return (await getPendingJobsSummary(types, userId)).pending;
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
  const heartbeatByWorkerId = await loadHeartbeatByWorkerId(runningWorkerIds);
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

export async function getSyncQueueSummaryForUserByProvider(
  userId: string,
  provider: PortalProvider,
  now = new Date(),
): Promise<SyncQueueSummary> {
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
      payload: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const filteredRows = rows
    .filter((row) => getQueuePayloadProvider(row.payload) === provider);

  const runningWorkerIds = Array.from(
    new Set(
      filteredRows
        .filter((row) => row.status === JobStatus.RUNNING && typeof row.workerId === "string" && row.workerId.length > 0)
        .map((row) => row.workerId as string),
    ),
  );
  const heartbeatByWorkerId = await loadHeartbeatByWorkerId(runningWorkerIds);
  const workerHeartbeatCutoffMs = now.getTime() - STALE_WORKER_TIMEOUT_MS;

  let runningCount = 0;
  let runningFresh = false;
  let runningStaleCount = 0;
  let pendingCount = 0;
  let pendingFresh = false;
  let pendingStaleCount = 0;
  const staleJobIds: string[] = [];

  for (const row of filteredRows) {
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
      const elapsedSeconds = toSafeInt(resultPatch.elapsedSeconds ?? resultPatch.watchedSeconds, 0);
      const totalElapsed = previousElapsed + elapsedSeconds;
      const truncated = resultPatch.truncated === true;
      const chainLimitReached = truncated && totalElapsed >= chainMaxSeconds;
      const shouldQueueContinuation = shouldQueueAutoLearnContinuation({
        provider: payload?.provider,
        truncated,
        chainLimitReached,
      });

      resultPatch.elapsedSeconds = elapsedSeconds;
      resultPatch.chainSegment = chainSegment;
      resultPatch.chainLimitReached = chainLimitReached;
      resultPatch.continuationQueued = false;
      if (!shouldQueueContinuation && payload?.provider === "CYBER_CAMPUS") {
        resultPatch.limitReached = truncated;
      }

      if (shouldQueueContinuation && payload && typeof payload.userId === "string" && payload.userId.length > 0) {
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

export async function markJobFailed(jobId: string, workerId: string, errorMessage: string): Promise<{
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
  retryQueued: boolean;
  retryJob: RetryJobSummary | null;
}> {
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
    const job = await prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
    return { job, retryQueued: false, retryJob: null };
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
    const job = await prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
    return { job, retryQueued: false, retryJob: null };
  }

  const updated = await prisma.jobQueue.findUniqueOrThrow({ where: { id: jobId } });
  let retryQueued = false;
  let retryJob: RetryJobSummary | null = null;

  if (
    shouldRetryFailedJob(updated.type, updated.attempts, errorMessage, {
      provider: getQueuePayloadProvider(updated.payload),
    })
  ) {
    const delayMinutes = getFailedJobRetryDelayMinutes(updated.attempts);
    const createdRetry = await prisma.jobQueue.create({
      data: {
        userId: updated.userId,
        type: updated.type,
        payload: updated.payload as unknown as Prisma.InputJsonValue,
        status: JobStatus.PENDING,
        runAfter: new Date(Date.now() + delayMinutes * 60_000),
        idempotencyKey: updated.idempotencyKey,
        attempts: updated.attempts,
      },
      select: {
        id: true,
        userId: true,
        type: true,
        runAfter: true,
      },
    });
    retryQueued = true;
    retryJob = createdRetry;
  }

  return { job: updated, retryQueued, retryJob };
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
      status: { in: [JobStatus.PENDING, JobStatus.BLOCKED, JobStatus.RUNNING] },
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
