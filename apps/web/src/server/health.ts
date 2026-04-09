import { JobStatus } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const WORKER_STALE_TIMEOUT_MS = 3 * 60 * 1000;
const PENDING_JOB_WARNING_MS = 10 * 60 * 1000;
const RUNNING_JOB_WARNING_MS = 10 * 60 * 1000;

export type ServiceHealthStatus = "ok" | "degraded" | "error";

export interface HealthDatabaseCheck {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface HealthWorkerDispatchCheck {
  ok: boolean;
  configured: boolean;
  owner: string | null;
  repo: string | null;
  workflowId: string | null;
  workflowRef: string | null;
  maxParallel: number;
}

export interface HealthWorkerCheck {
  ok: boolean;
  activeWorkerCount: number;
  latestWorkerId: string | null;
  latestHeartbeatAt: string | null;
  latestHeartbeatAgeSeconds: number | null;
  staleAfterSeconds: number;
}

export interface HealthQueueCheck {
  ok: boolean;
  runningCount: number;
  pendingCount: number;
  blockedCount: number;
  staleRunningCount: number;
  stalePendingCount: number;
  oldestPendingAgeSeconds: number | null;
  oldestPendingType: string | null;
  backlogWarningThreshold: number;
}

export interface ServiceHealthPayload {
  ok: boolean;
  status: ServiceHealthStatus;
  service: "cu12-web";
  ts: string;
  responseTimeMs: number;
  checks: {
    database: HealthDatabaseCheck;
    workerDispatch: HealthWorkerDispatchCheck;
    worker: HealthWorkerCheck;
    queue: HealthQueueCheck;
  };
  issues: string[];
}

export interface ServiceHealthEvaluationInput {
  databaseOk: boolean;
  dispatchConfigured: boolean;
  activeWorkerCount: number;
  latestHeartbeatAgeMs: number | null;
  runningCount: number;
  pendingCount: number;
  blockedCount: number;
  staleRunningCount: number;
  stalePendingCount: number;
  backlogWarningThreshold: number;
}

export function evaluateServiceHealth(input: ServiceHealthEvaluationInput): {
  status: ServiceHealthStatus;
  workerOk: boolean;
  workerDispatchOk: boolean;
  queueOk: boolean;
  issues: string[];
} {
  if (!input.databaseOk) {
    return {
      status: "error",
      workerOk: false,
      workerDispatchOk: input.dispatchConfigured,
      queueOk: false,
      issues: ["Database connectivity check failed."],
    };
  }

  const issues: string[] = [];

  const workerDispatchOk = input.dispatchConfigured;
  if (!workerDispatchOk) {
    issues.push("Worker dispatch is not fully configured.");
  }

  let workerOk = true;
  const workerLoadExists = input.runningCount > 0 || input.pendingCount > 0 || input.blockedCount > 0;

  if (workerLoadExists && input.activeWorkerCount === 0) {
    workerOk = false;
    issues.push("No active worker heartbeat is available while jobs exist.");
  } else if (
    workerLoadExists
    && input.latestHeartbeatAgeMs !== null
    && input.latestHeartbeatAgeMs > WORKER_STALE_TIMEOUT_MS
  ) {
    workerOk = false;
    issues.push("Latest worker heartbeat is stale.");
  }

  if (input.staleRunningCount > 0) {
    workerOk = false;
    issues.push(`${input.staleRunningCount} running job(s) appear orphaned or stalled.`);
  }

  let queueOk = true;
  if (input.stalePendingCount > 0) {
    queueOk = false;
    issues.push(
      `${input.stalePendingCount} pending job(s) have been waiting longer than ${Math.floor(PENDING_JOB_WARNING_MS / 60000)} minutes.`,
    );
  }

  if (input.pendingCount >= input.backlogWarningThreshold) {
    queueOk = false;
    issues.push(
      `Pending queue depth ${input.pendingCount} exceeds warning threshold ${input.backlogWarningThreshold}.`,
    );
  }

  if (issues.length > 0) {
    return {
      status: "degraded",
      workerOk,
      workerDispatchOk,
      queueOk,
      issues,
    };
  }

  return {
    status: "ok",
    workerOk,
    workerDispatchOk,
    queueOk,
    issues,
  };
}

function toAgeSeconds(from: Date | null | undefined, now: Date): number | null {
  if (!from) return null;
  const ageMs = now.getTime() - from.getTime();
  return Math.max(0, Math.floor(ageMs / 1000));
}

export async function getServiceHealth(): Promise<ServiceHealthPayload> {
  const startedAt = Date.now();
  const checkedAt = new Date();
  const env = getEnv();

  const workerDispatchConfigured = Boolean(
    env.GITHUB_OWNER && env.GITHUB_REPO && env.GITHUB_WORKFLOW_ID && env.GITHUB_TOKEN,
  );

  const workerDispatchCheck: HealthWorkerDispatchCheck = {
    ok: workerDispatchConfigured,
    configured: workerDispatchConfigured,
    owner: env.GITHUB_OWNER ?? null,
    repo: env.GITHUB_REPO ?? null,
    workflowId: env.GITHUB_WORKFLOW_ID ?? null,
    workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
    maxParallel: env.WORKER_DISPATCH_MAX_PARALLEL,
  };

  const dbStartedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    const databaseCheck: HealthDatabaseCheck = {
      ok: false,
      latencyMs: Date.now() - dbStartedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    const evaluation = evaluateServiceHealth({
      databaseOk: false,
      dispatchConfigured: workerDispatchConfigured,
      activeWorkerCount: 0,
      latestHeartbeatAgeMs: null,
      runningCount: 0,
      pendingCount: 0,
      blockedCount: 0,
      staleRunningCount: 0,
      stalePendingCount: 0,
      backlogWarningThreshold: Math.max(10, env.WORKER_DISPATCH_MAX_PARALLEL * 2),
    });

    return {
      ok: false,
      status: evaluation.status,
      service: "cu12-web",
      ts: checkedAt.toISOString(),
      responseTimeMs: Date.now() - startedAt,
      checks: {
        database: databaseCheck,
        workerDispatch: workerDispatchCheck,
        worker: {
          ok: false,
          activeWorkerCount: 0,
          latestWorkerId: null,
          latestHeartbeatAt: null,
          latestHeartbeatAgeSeconds: null,
          staleAfterSeconds: Math.floor(WORKER_STALE_TIMEOUT_MS / 1000),
        },
        queue: {
          ok: false,
          runningCount: 0,
          pendingCount: 0,
          blockedCount: 0,
          staleRunningCount: 0,
          stalePendingCount: 0,
          oldestPendingAgeSeconds: null,
          oldestPendingType: null,
          backlogWarningThreshold: Math.max(10, env.WORKER_DISPATCH_MAX_PARALLEL * 2),
        },
      },
      issues: [databaseCheck.error ?? "Database connectivity check failed."],
    };
  }

  const databaseCheck: HealthDatabaseCheck = {
    ok: true,
    latencyMs: Date.now() - dbStartedAt,
    error: null,
  };

  const backlogWarningThreshold = Math.max(10, env.WORKER_DISPATCH_MAX_PARALLEL * 2);
  const workerFreshCutoff = new Date(checkedAt.getTime() - WORKER_STALE_TIMEOUT_MS);
  const pendingWarningCutoff = new Date(checkedAt.getTime() - PENDING_JOB_WARNING_MS);
  const runningWarningCutoff = new Date(checkedAt.getTime() - RUNNING_JOB_WARNING_MS);

  const [
    latestHeartbeat,
    activeWorkerCount,
    runningCount,
    pendingCount,
    blockedCount,
    stalePendingCount,
    oldestPendingJob,
    runningJobs,
  ] = await Promise.all([
    prisma.workerHeartbeat.findFirst({
      orderBy: { lastSeenAt: "desc" },
      select: { workerId: true, lastSeenAt: true },
    }),
    prisma.workerHeartbeat.count({
      where: {
        lastSeenAt: { gte: workerFreshCutoff },
      },
    }),
    prisma.jobQueue.count({
      where: { status: JobStatus.RUNNING },
    }),
    prisma.jobQueue.count({
      where: { status: JobStatus.PENDING },
    }),
    prisma.jobQueue.count({
      where: { status: JobStatus.BLOCKED },
    }),
    prisma.jobQueue.count({
      where: {
        status: JobStatus.PENDING,
        runAfter: { lt: pendingWarningCutoff },
      },
    }),
    prisma.jobQueue.findFirst({
      where: { status: JobStatus.PENDING },
      orderBy: [{ runAfter: "asc" }, { createdAt: "asc" }],
      select: {
        type: true,
        runAfter: true,
      },
    }),
    prisma.jobQueue.findMany({
      where: { status: JobStatus.RUNNING },
      select: {
        workerId: true,
        startedAt: true,
      },
    }),
  ]);

  const runningWorkerIds = Array.from(
    new Set(
      runningJobs
        .map((job) => job.workerId)
        .filter((workerId): workerId is string => Boolean(workerId)),
    ),
  );

  const runningHeartbeats = runningWorkerIds.length === 0
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

  const heartbeatByWorkerId = new Map(runningHeartbeats.map((heartbeat) => [heartbeat.workerId, heartbeat.lastSeenAt]));

  let staleRunningCount = 0;
  for (const job of runningJobs) {
    if (!job.startedAt || job.startedAt >= runningWarningCutoff) {
      continue;
    }

    const heartbeatAt = job.workerId ? heartbeatByWorkerId.get(job.workerId) : null;
    const heartbeatIsFresh = heartbeatAt ? heartbeatAt >= workerFreshCutoff : false;
    if (!heartbeatIsFresh) {
      staleRunningCount += 1;
    }
  }

  const latestHeartbeatAgeSeconds = toAgeSeconds(latestHeartbeat?.lastSeenAt, checkedAt);
  const oldestPendingAgeSeconds = oldestPendingJob ? toAgeSeconds(oldestPendingJob.runAfter, checkedAt) : null;

  const evaluation = evaluateServiceHealth({
    databaseOk: true,
    dispatchConfigured: workerDispatchConfigured,
    activeWorkerCount,
    latestHeartbeatAgeMs: latestHeartbeatAgeSeconds === null ? null : latestHeartbeatAgeSeconds * 1000,
    runningCount,
    pendingCount,
    blockedCount,
    staleRunningCount,
    stalePendingCount,
    backlogWarningThreshold,
  });

  return {
    ok: evaluation.status !== "error",
    status: evaluation.status,
    service: "cu12-web",
    ts: checkedAt.toISOString(),
    responseTimeMs: Date.now() - startedAt,
    checks: {
      database: databaseCheck,
      workerDispatch: {
        ...workerDispatchCheck,
        ok: evaluation.workerDispatchOk,
      },
      worker: {
        ok: evaluation.workerOk,
        activeWorkerCount,
        latestWorkerId: latestHeartbeat?.workerId ?? null,
        latestHeartbeatAt: latestHeartbeat?.lastSeenAt.toISOString() ?? null,
        latestHeartbeatAgeSeconds,
        staleAfterSeconds: Math.floor(WORKER_STALE_TIMEOUT_MS / 1000),
      },
      queue: {
        ok: evaluation.queueOk,
        runningCount,
        pendingCount,
        blockedCount,
        staleRunningCount,
        stalePendingCount,
        oldestPendingAgeSeconds,
        oldestPendingType: oldestPendingJob?.type ?? null,
        backlogWarningThreshold,
      },
    },
    issues: evaluation.issues,
  };
}
