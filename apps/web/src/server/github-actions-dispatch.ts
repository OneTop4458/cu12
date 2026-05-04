import { JobStatus, JobType } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export type WorkerDispatchType = "sync" | "autolearn" | "digest" | "cyber-campus-approval";
export type WorkerDispatchState =
  | "DISPATCHED"
  | "NOT_CONFIGURED"
  | "FAILED"
  | "SKIPPED_DUPLICATE"
  | "SKIPPED_CAPACITY"
  | "SKIPPED_NO_PENDING";
export type WorkerRunCancelState = "REQUESTED" | "NOT_CONFIGURED" | "NOT_APPLICABLE" | "FAILED";

export interface WorkerDispatchResult {
  state: WorkerDispatchState;
  dispatched: boolean;
  errorCode: string | null;
  error?: string;
  statusCode?: number;
  dispatchCount?: number;
  capacity?: number;
  activeRunCount?: number;
}

export interface WorkerRunCancelResult {
  state: WorkerRunCancelState;
  runId: number | null;
  errorCode: string | null;
  error?: string;
  statusCode?: number;
}

interface GitHubWorkflowRun {
  id: number;
  status: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRun[];
}

interface PendingCandidateUsersResult {
  users: string[];
  preferredBlockedByRunning: boolean;
}

const JOB_TYPE_PRIORITY: JobType[] = [
  JobType.SYNC,
  JobType.NOTICE_SCAN,
  JobType.AUTOLEARN,
  JobType.MAIL_DIGEST,
];

const SYNC_DISPATCH_TYPES: readonly JobType[] = [JobType.SYNC, JobType.NOTICE_SCAN];

function rankJobTypes(inputTypes: JobType[]): JobType[] {
  const unique = Array.from(new Set(inputTypes));
  const ordered: JobType[] = [];

  for (const type of JOB_TYPE_PRIORITY) {
    if (unique.includes(type)) {
      ordered.push(type);
    }
  }

  for (const type of unique) {
    if (!ordered.includes(type)) {
      ordered.push(type);
    }
  }

  return ordered;
}

function hasAnyJobType(inputTypes: JobType[], targetTypes: readonly JobType[]): boolean {
  return inputTypes.some((type) => targetTypes.includes(type));
}

export function getRunningBlockerTypesForDispatch(inputTypes: JobType[]): JobType[] {
  const types = rankJobTypes(inputTypes);
  const blockers: JobType[] = [];

  if (hasAnyJobType(types, SYNC_DISPATCH_TYPES)) {
    blockers.push(...SYNC_DISPATCH_TYPES);
  }
  if (types.includes(JobType.AUTOLEARN)) {
    blockers.push(JobType.AUTOLEARN);
  }
  if (types.includes(JobType.MAIL_DIGEST)) {
    blockers.push(JobType.MAIL_DIGEST);
  }

  return rankJobTypes(blockers);
}

function parseJobTypes(jobTypes?: string): JobType[] {
  if (!jobTypes || !jobTypes.trim()) return [];
  const tokens = jobTypes
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);
  const types: JobType[] = [];
  for (const token of tokens) {
    if (!Object.values(JobType).includes(token as JobType)) continue;
    types.push(token as JobType);
  }
  return rankJobTypes(types);
}

function resolveTypesFromTrigger(type: WorkerDispatchType): JobType[] {
  if (type === "autolearn") return [JobType.AUTOLEARN];
  if (type === "digest") return [JobType.MAIL_DIGEST];
  if (type === "cyber-campus-approval") return [];
  return [JobType.SYNC, JobType.NOTICE_SCAN];
}

function resolveTriggerFromTypes(types: JobType[], fallback: WorkerDispatchType): WorkerDispatchType {
  if (types.includes(JobType.AUTOLEARN)) return "autolearn";
  if (types.includes(JobType.SYNC) || types.includes(JobType.NOTICE_SCAN)) return "sync";
  if (types.includes(JobType.MAIL_DIGEST)) return "digest";
  return fallback;
}

function resolveDispatchCapacity() {
  const env = getEnv();
  return Math.max(1, env.WORKER_DISPATCH_MAX_PARALLEL);
}

function toDispatchPayload(input: {
  trigger: WorkerDispatchType;
  userId?: string;
  jobTypes?: string;
  approvalId?: string;
}) {
  const payload: Record<string, unknown> = {
    ref: getEnv().GITHUB_WORKFLOW_REF,
    inputs: {
      trigger: input.trigger,
    },
  };

  if (input.userId) {
    (payload.inputs as Record<string, unknown>).userId = input.userId;
  }
  if (input.jobTypes) {
    (payload.inputs as Record<string, unknown>).jobTypes = input.jobTypes;
  }
  if (input.approvalId) {
    (payload.inputs as Record<string, unknown>).approvalId = input.approvalId;
  }

  return payload;
}

async function listActiveWorkerRuns(): Promise<number> {
  const env = getEnv();
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/runs?per_page=100`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GITHUB_RUN_LIST_FAILED:${response.status}:${text}`);
  }

  const body = await response.json().then((value) => value as GitHubWorkflowRunsResponse);
  const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return runs.filter((run) => run.status !== "completed").length;
}

async function listPendingCandidateUsers(input: {
  types: JobType[];
  preferredUserId?: string;
  limit: number;
}): Promise<PendingCandidateUsersResult> {
  if (input.limit <= 0 || input.types.length === 0) {
    return { users: [], preferredBlockedByRunning: false };
  }
  const now = new Date();
  const runningBlockerTypes = getRunningBlockerTypesForDispatch(input.types);

  const runningRows = await prisma.jobQueue.findMany({
    where: {
      status: JobStatus.RUNNING,
      type: { in: runningBlockerTypes },
    },
    select: {
      userId: true,
      type: true,
    },
  });

  const preferredBlockedByRunning = Boolean(
    input.preferredUserId
    && runningRows.some((row) => row.userId === input.preferredUserId),
  );

  let preferredHasEligiblePending = false;
  if (input.preferredUserId) {
    const preferredPending = await prisma.jobQueue.findFirst({
      where: {
        userId: input.preferredUserId,
        type: { in: input.types },
        status: JobStatus.PENDING,
        runAfter: { lte: now },
      },
      select: { id: true },
    });
    preferredHasEligiblePending = Boolean(preferredPending);
  }

  const pendingRows = await prisma.jobQueue.findMany({
    where: {
      type: { in: input.types },
      status: JobStatus.PENDING,
      runAfter: { lte: now },
    },
    select: {
      userId: true,
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(200, input.limit * 50),
  });

  return {
    users: selectPendingCandidateUsersFromRows({
      types: input.types,
      preferredUserId: input.preferredUserId,
      preferredHasEligiblePending,
      runningRows,
      pendingRows,
      limit: input.limit,
    }),
    preferredBlockedByRunning,
  };
}

export function selectPendingCandidateUsersFromRows(input: {
  types: JobType[];
  preferredUserId?: string;
  preferredHasEligiblePending?: boolean;
  runningRows: Array<{ userId: string; type: JobType }>;
  pendingRows: Array<{ userId: string }>;
  limit: number;
}): string[] {
  if (input.limit <= 0 || input.types.length === 0) return [];
  const runningBlockerTypes = new Set(getRunningBlockerTypesForDispatch(input.types));
  const runningUsers = new Set(
    input.runningRows
      .filter((row) => runningBlockerTypes.has(row.type))
      .map((row) => row.userId),
  );
  const result: string[] = [];
  const seen = new Set<string>();

  if (
    input.preferredUserId
    && input.preferredHasEligiblePending
    && !runningUsers.has(input.preferredUserId)
  ) {
    result.push(input.preferredUserId);
    seen.add(input.preferredUserId);
  }

  if (result.length >= input.limit) {
    return result.slice(0, input.limit);
  }

  for (const row of input.pendingRows) {
    if (runningUsers.has(row.userId)) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    result.push(row.userId);
    if (result.length >= input.limit) break;
  }

  return result;
}

async function resolvePendingTypesForUser(userId: string, allowedTypes: JobType[]): Promise<JobType[]> {
  const now = new Date();
  const rows = await prisma.jobQueue.findMany({
    where: {
      userId,
      type: { in: allowedTypes },
      status: JobStatus.PENDING,
      runAfter: { lte: now },
    },
    select: { type: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rankJobTypes(rows.map((row) => row.type));
}

async function dispatchWorkerRunRequest(
  trigger: WorkerDispatchType,
  userId?: string,
  jobTypes?: string,
  approvalId?: string,
): Promise<WorkerDispatchResult> {
  const env = getEnv();
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/dispatches`;
  const payload = toDispatchPayload({ trigger, userId, jobTypes, approvalId });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.status !== 204) {
    const text = await response.text();
    return {
      state: "FAILED",
      dispatched: false,
      errorCode: "GITHUB_DISPATCH_FAILED",
      error: `GITHUB_DISPATCH_FAILED:${response.status}:${text}`,
      statusCode: response.status,
    };
  }

  return {
    state: "DISPATCHED",
    dispatched: true,
    errorCode: null,
  };
}

export function parseGitHubRunIdFromWorkerId(workerId: string | null | undefined): number | null {
  if (!workerId) return null;
  const raw = workerId.trim();
  if (!raw) return null;

  const directNumber = raw.match(/^(\d+)$/);
  if (directNumber?.[1]) {
    const parsed = Number(directNumber[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (/^gha/i.test(raw)) {
    const ghaMatch = raw.match(/^gha[-_](\d+)(?:[-_][^/\\-_\s]+)?$/i);
    if (ghaMatch?.[1]) {
      const parsed = Number(ghaMatch[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    const legacyMatch = raw.match(/^gha-(\d+)-\d+$/i);
    if (legacyMatch?.[1]) {
      const parsed = Number(legacyMatch[1]);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }

  const actionRunMatch = raw.match(/actions\/runs\/(\d+)/i);
  if (actionRunMatch?.[1]) {
    const parsed = Number(actionRunMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const runPrefixMatch = raw.match(/^run[_-]?(?:id)?[_-]?(\d+)$/i);
  if (runPrefixMatch?.[1]) {
    const parsed = Number(runPrefixMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export async function dispatchWorkerRun(
  type: WorkerDispatchType,
  userId?: string,
  jobTypes?: string,
  approvalId?: string,
): Promise<WorkerDispatchResult> {
  const env = getEnv();
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_WORKFLOW_ID || !env.GITHUB_TOKEN) {
    return {
      state: "NOT_CONFIGURED",
      dispatched: false,
      errorCode: "GITHUB_DISPATCH_NOT_CONFIGURED",
      error: "GITHUB_DISPATCH_NOT_CONFIGURED",
    };
  }

  let activeRunCount = 0;
  try {
    activeRunCount = await listActiveWorkerRuns();
  } catch (error) {
    return {
      state: "FAILED",
      dispatched: false,
      errorCode: "GITHUB_RUN_LIST_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const capacity = resolveDispatchCapacity();
  const availableSlots = Math.max(0, capacity - activeRunCount);
  if (availableSlots <= 0) {
    return {
      state: "SKIPPED_CAPACITY",
      dispatched: false,
      errorCode: "WORKER_DISPATCH_CAPACITY_REACHED",
      dispatchCount: 0,
      activeRunCount,
      capacity,
    };
  }

  if (type === "cyber-campus-approval") {
    const directDispatch = await dispatchWorkerRunRequest(type, undefined, undefined, approvalId);
    return {
      ...directDispatch,
      dispatchCount: directDispatch.dispatched ? 1 : 0,
      activeRunCount,
      capacity,
    };
  }

  const parsedTypes = parseJobTypes(jobTypes);
  const targetTypes = parsedTypes.length > 0 ? parsedTypes : resolveTypesFromTrigger(type);
  const candidateResult = await listPendingCandidateUsers({
    types: targetTypes,
    preferredUserId: userId,
    limit: userId ? 1 : availableSlots,
  });
  const candidateUsers = candidateResult.users;

  if (candidateUsers.length === 0) {
    if (userId && candidateResult.preferredBlockedByRunning) {
      return {
        state: "SKIPPED_DUPLICATE",
        dispatched: false,
        errorCode: "WORKER_DISPATCH_USER_RUNNING",
        dispatchCount: 0,
        activeRunCount,
        capacity,
      };
    }

    return {
      state: "SKIPPED_NO_PENDING",
      dispatched: false,
      errorCode: "WORKER_DISPATCH_NO_PENDING",
      dispatchCount: 0,
      activeRunCount,
      capacity,
    };
  }

  let dispatchCount = 0;
  let lastFailure: WorkerDispatchResult | null = null;

  for (const candidateUserId of candidateUsers) {
    if (dispatchCount >= availableSlots) break;
    const pendingTypes = await resolvePendingTypesForUser(candidateUserId, targetTypes);
    if (pendingTypes.length === 0) continue;

    const trigger = resolveTriggerFromTypes(pendingTypes, type);
    const response = await dispatchWorkerRunRequest(trigger, candidateUserId, pendingTypes.join(","));
    if (response.dispatched) {
      dispatchCount += 1;
      continue;
    }

    lastFailure = response;
  }

  if (dispatchCount > 0) {
    return {
      state: "DISPATCHED",
      dispatched: true,
      errorCode: null,
      dispatchCount,
      activeRunCount,
      capacity,
    };
  }

  if (lastFailure) {
    return {
      ...lastFailure,
      dispatchCount: 0,
      activeRunCount,
      capacity,
    };
  }

  return {
    state: "SKIPPED_NO_PENDING",
    dispatched: false,
    errorCode: "WORKER_DISPATCH_NO_PENDING",
    dispatchCount: 0,
    activeRunCount,
    capacity,
  };
}

export async function cancelGitHubRunByWorkerId(workerId: string | null | undefined): Promise<WorkerRunCancelResult> {
  const runId = parseGitHubRunIdFromWorkerId(workerId);
  if (!runId) {
    return {
      state: "NOT_APPLICABLE",
      runId: null,
      errorCode: null,
    };
  }

  const env = getEnv();
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_TOKEN) {
    return {
      state: "NOT_CONFIGURED",
      runId,
      errorCode: "GITHUB_CANCEL_NOT_CONFIGURED",
      error: "GITHUB_CANCEL_NOT_CONFIGURED",
    };
  }

  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs/${runId}/cancel`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (response.status !== 202 && response.status !== 204) {
    const text = await response.text();
    return {
      state: "FAILED",
      runId,
      errorCode: "GITHUB_CANCEL_FAILED",
      error: `GITHUB_CANCEL_FAILED:${response.status}:${text}`,
      statusCode: response.status,
    };
  }

  return {
    state: "REQUESTED",
    runId,
    errorCode: null,
    statusCode: response.status,
  };
}
