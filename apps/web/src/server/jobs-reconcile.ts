import type { PortalProvider } from "@cu12/core";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { parseGitHubRunIdFromWorkerId } from "@/server/github-actions-dispatch";
import { getFailedJobRetryDelayMinutes, getQueuePayloadProvider, shouldRetryFailedJob } from "@/server/queue";

interface GitHubWorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRun[];
}

interface GitHubContentsResponse {
  content?: string;
  encoding?: string;
}

export interface JobReconcileDbItem {
  id: string;
  userId: string;
  type: string;
  status: string;
  workerId: string | null;
  runId: number | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobReconcileGhRun {
  id: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobReconcileSummary {
  runningJobsCount: number;
  orphanedRunningJobsCount: number;
  activeRunsCount: number;
  ghostRunsCount: number;
  nonparseableWorkerIdCount: number;
}

export type ScheduleCheckKey = "sync" | "autolearn";
export type ScheduleCheckStatus = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface JobScheduleCheck {
  key: ScheduleCheckKey;
  workflowPath: string;
  expectedCrons: string[];
  actualCrons: string[];
  status: ScheduleCheckStatus;
  message: string;
}

export interface JobReconcileResult {
  checkedAt: string;
  canReconcileWithGitHub: boolean;
  summary: JobReconcileSummary;
  scheduleChecks: JobScheduleCheck[];
  runningJobs: JobReconcileDbItem[];
  orphanedRunningJobs: JobReconcileDbItem[];
  activeRuns: JobReconcileGhRun[];
  ghostRuns: JobReconcileGhRun[];
  error?: string;
}

export const ORPHANED_WORKER_ERROR = "WORKER_RUN_ORPHANED";

export type OrphanedRunningJobRepairAction = "REQUEUE" | "MARK_FAILED";

export interface OrphanedRunningJobRepairDecision {
  action: OrphanedRunningJobRepairAction;
  retryQueued: boolean;
  retryDelayMinutes: number | null;
}

export interface JobReconcileRepairRetryJob {
  id: string;
  userId: string;
  type: string;
  runAfter: string;
}

export interface JobReconcileRepairItem {
  id: string;
  userId: string | null;
  type: string | null;
  previousStatus: string | null;
  action: OrphanedRunningJobRepairAction | "SKIP";
  updated: boolean;
  retryQueued: boolean;
  retryJob: JobReconcileRepairRetryJob | null;
  message: string;
}

export interface JobReconcileRepairSummary {
  inspectedOrphanedRunningJobsCount: number;
  repairedJobsCount: number;
  requeuedJobsCount: number;
  failedJobsCount: number;
  retryQueuedCount: number;
  canceledCyberCampusAutoLearnRetryCount: number;
  skippedJobsCount: number;
}

export interface JobReconcileRepairResult {
  checkedAt: string;
  canReconcileWithGitHub: boolean;
  before: JobReconcileResult;
  summary: JobReconcileRepairSummary;
  repairedJobs: JobReconcileRepairItem[];
  skippedJobs: JobReconcileRepairItem[];
  error?: string;
}

const EXPECTED_SCHEDULES: Array<{
  key: ScheduleCheckKey;
  workflowPath: string;
  expectedCrons: string[];
}> = [
  {
    key: "sync",
    workflowPath: ".github/workflows/sync-schedule.yml",
    expectedCrons: ["0 */12 * * *"],
  },
  {
    key: "autolearn",
    workflowPath: ".github/workflows/autolearn-dispatch.yml",
    expectedCrons: ["20 0 * * *"],
  },
];

function isRequeueRepairType(type: JobType): boolean {
  return type === JobType.SYNC || type === JobType.NOTICE_SCAN;
}

export function decideOrphanedRunningJobRepair(input: {
  type: JobType;
  attempts: number;
  provider?: PortalProvider | null;
}): OrphanedRunningJobRepairDecision {
  if (isRequeueRepairType(input.type)) {
    return {
      action: "REQUEUE",
      retryQueued: false,
      retryDelayMinutes: null,
    };
  }

  const retryQueued = input.type === JobType.AUTOLEARN
    && shouldRetryFailedJob(input.type, input.attempts, ORPHANED_WORKER_ERROR, {
      provider: input.provider,
    });

  return {
    action: "MARK_FAILED",
    retryQueued,
    retryDelayMinutes: retryQueued ? getFailedJobRetryDelayMinutes(input.attempts) : null,
  };
}

export function isSameObservedRunningJob(input: {
  current: { status: JobStatus; workerId: string | null };
  observed: { workerId: string | null };
}): boolean {
  return input.current.status === JobStatus.RUNNING
    && input.current.workerId === input.observed.workerId;
}

function isActiveWorkflowRun(status: string): boolean {
  return status !== "completed";
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function normalizeCronList(crons: string[]): string[] {
  return Array.from(
    new Set(
      crons
        .map((cron) => cron.trim())
        .filter((cron) => cron.length > 0),
    ),
  ).sort();
}

function parseCronsFromWorkflowYaml(content: string): string[] {
  const matches = content.matchAll(/cron:\s*["']([^"']+)["']/g);
  const parsed: string[] = [];
  for (const match of matches) {
    const cron = match[1]?.trim();
    if (cron) {
      parsed.push(cron);
    }
  }
  return normalizeCronList(parsed);
}

function createUnknownScheduleChecks(reason: string): JobScheduleCheck[] {
  return EXPECTED_SCHEDULES.map((entry) => ({
    key: entry.key,
    workflowPath: entry.workflowPath,
    expectedCrons: entry.expectedCrons,
    actualCrons: [],
    status: "UNKNOWN",
    message: reason,
  }));
}

function buildScheduleCheck(
  key: ScheduleCheckKey,
  workflowPath: string,
  expectedCrons: string[],
  actualCrons: string[],
): JobScheduleCheck {
  const expected = normalizeCronList(expectedCrons);
  const actual = normalizeCronList(actualCrons);
  const isMatch = expected.length === actual.length && expected.every((cron, idx) => cron === actual[idx]);

  if (isMatch) {
    return {
      key,
      workflowPath,
      expectedCrons: expected,
      actualCrons: actual,
      status: "MATCH",
      message: "Workflow schedule matches the expected cron configuration.",
    };
  }

  return {
    key,
    workflowPath,
    expectedCrons: expected,
    actualCrons: actual,
    status: "MISMATCH",
    message: actual.length === 0
      ? "No cron schedule was found in workflow configuration."
      : "Workflow schedule differs from expected cron configuration.",
  };
}

async function fetchGitHubWorkflowContent(
  owner: string,
  repo: string,
  workflowPath: string,
  ref: string,
  token: string,
): Promise<string> {
  const encodedPath = workflowPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GITHUB_WORKFLOW_CONTENT_FAILED:${workflowPath}:${response.status}:${text}`);
  }

  const body = await response.json().then((value) => value as GitHubContentsResponse);
  if (body.encoding !== "base64" || typeof body.content !== "string") {
    throw new Error(`GITHUB_WORKFLOW_CONTENT_INVALID:${workflowPath}`);
  }

  return Buffer.from(body.content, "base64").toString("utf8");
}

async function resolveWorkflowScheduleChecks(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<JobScheduleCheck[]> {
  const checks: JobScheduleCheck[] = [];

  for (const entry of EXPECTED_SCHEDULES) {
    try {
      const content = await fetchGitHubWorkflowContent(owner, repo, entry.workflowPath, ref, token);
      checks.push(buildScheduleCheck(entry.key, entry.workflowPath, entry.expectedCrons, parseCronsFromWorkflowYaml(content)));
    } catch (error) {
      checks.push({
        key: entry.key,
        workflowPath: entry.workflowPath,
        expectedCrons: normalizeCronList(entry.expectedCrons),
        actualCrons: [],
        status: "UNKNOWN",
        message: error instanceof Error ? error.message : "Failed to inspect workflow schedule.",
      });
    }
  }

  return checks;
}

async function listActiveWorkflowRuns(owner: string, repo: string, workflowId: string, token: string) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=100`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GITHUB_RUN_LIST_FAILED:${response.status}:${text}`);
  }

  const body = await response.json().then((value) => value as GitHubWorkflowRunsResponse);
  const workflowRuns = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  return workflowRuns
    .filter((run) => isActiveWorkflowRun(run.status))
    .map((run) => ({
      id: run.id,
      status: run.status,
      conclusion: run.conclusion ?? null,
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    }));
}

export async function getJobReconcileResult(): Promise<JobReconcileResult> {
  const env = getEnv();
  const checkedAt = new Date().toISOString();

  const runningJobs = await prisma.jobQueue.findMany({
    where: { status: JobStatus.RUNNING },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      workerId: true,
      startedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const runningJobSummaries: JobReconcileDbItem[] = runningJobs.map((job) => ({
    id: job.id,
    userId: job.userId,
    type: job.type,
    status: job.status,
    workerId: job.workerId,
    runId: parseGitHubRunIdFromWorkerId(job.workerId),
    startedAt: formatDate(job.startedAt),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }));

  const runningJobRunIds = new Set<number>();
  let nonparseableWorkerIdCount = 0;
  for (const job of runningJobSummaries) {
    if (job.workerId && job.runId === null) {
      nonparseableWorkerIdCount += 1;
    } else if (job.runId) {
      runningJobRunIds.add(job.runId);
    }
  }

  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_WORKFLOW_ID || !env.GITHUB_TOKEN) {
    return {
      checkedAt,
      canReconcileWithGitHub: false,
      summary: {
        runningJobsCount: runningJobSummaries.length,
        orphanedRunningJobsCount: 0,
        activeRunsCount: 0,
        ghostRunsCount: 0,
        nonparseableWorkerIdCount,
      },
      scheduleChecks: createUnknownScheduleChecks("GITHUB_WORKFLOW_SCHEDULE_NOT_CONFIGURED"),
      runningJobs: runningJobSummaries,
      orphanedRunningJobs: [],
      activeRuns: [],
      ghostRuns: [],
      error: "GITHUB_RUN_LIST_NOT_CONFIGURED",
    };
  }

  const scheduleChecks = await resolveWorkflowScheduleChecks(
    env.GITHUB_OWNER,
    env.GITHUB_REPO,
    env.GITHUB_WORKFLOW_REF,
    env.GITHUB_TOKEN,
  );

  try {
    const activeRuns = await listActiveWorkflowRuns(
      env.GITHUB_OWNER,
      env.GITHUB_REPO,
      env.GITHUB_WORKFLOW_ID,
      env.GITHUB_TOKEN,
    );
    const activeRunIdSet = new Set(activeRuns.map((run) => run.id));
    const orphanedRunningJobs = runningJobSummaries.filter((job) => !job.runId || !activeRunIdSet.has(job.runId));
    const ghostRuns = activeRuns.filter((run) => !runningJobRunIds.has(run.id));

    return {
      checkedAt,
      canReconcileWithGitHub: true,
      summary: {
        runningJobsCount: runningJobSummaries.length,
        orphanedRunningJobsCount: orphanedRunningJobs.length,
        activeRunsCount: activeRuns.length,
        ghostRunsCount: ghostRuns.length,
        nonparseableWorkerIdCount,
      },
      scheduleChecks,
      runningJobs: runningJobSummaries,
      orphanedRunningJobs,
      activeRuns,
      ghostRuns,
    };
  } catch (error) {
    return {
      checkedAt,
      canReconcileWithGitHub: false,
      summary: {
        runningJobsCount: runningJobSummaries.length,
        orphanedRunningJobsCount: 0,
        activeRunsCount: 0,
        ghostRunsCount: 0,
        nonparseableWorkerIdCount,
      },
      scheduleChecks,
      runningJobs: runningJobSummaries,
      orphanedRunningJobs: [],
      activeRuns: [],
      ghostRuns: [],
      error: error instanceof Error ? error.message : "GITHUB_RUN_LIST_FAILED",
    };
  }
}

async function repairOrphanedRunningJob(
  observed: JobReconcileDbItem,
  now: Date,
): Promise<JobReconcileRepairItem> {
  const current = await prisma.jobQueue.findUnique({
    where: { id: observed.id },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      workerId: true,
      payload: true,
      attempts: true,
      idempotencyKey: true,
    },
  });

  if (!current) {
    return {
      id: observed.id,
      userId: null,
      type: null,
      previousStatus: null,
      action: "SKIP",
      updated: false,
      retryQueued: false,
      retryJob: null,
      message: "Job disappeared before repair.",
    };
  }

  if (!isSameObservedRunningJob({ current, observed })) {
    return {
      id: current.id,
      userId: current.userId,
      type: current.type,
      previousStatus: current.status,
      action: "SKIP",
      updated: false,
      retryQueued: false,
      retryJob: null,
      message: "Job changed before repair could update it.",
    };
  }

  const decision = decideOrphanedRunningJobRepair({
    type: current.type,
    attempts: current.attempts,
    provider: getQueuePayloadProvider(current.payload),
  });

  if (decision.action === "REQUEUE") {
    const repaired = await prisma.jobQueue.updateMany({
      where: {
        id: current.id,
        status: JobStatus.RUNNING,
        workerId: observed.workerId,
      },
      data: {
        status: JobStatus.PENDING,
        startedAt: null,
        workerId: null,
        finishedAt: null,
        runAfter: now,
        lastError: ORPHANED_WORKER_ERROR,
        result: Prisma.JsonNull,
      },
    });

    return {
      id: current.id,
      userId: current.userId,
      type: current.type,
      previousStatus: JobStatus.RUNNING,
      action: "REQUEUE",
      updated: repaired.count > 0,
      retryQueued: false,
      retryJob: null,
      message: repaired.count > 0
        ? "Orphaned RUNNING job was returned to PENDING."
        : "Job changed before repair could update it.",
    };
  }

  const repaired = await prisma.$transaction(async (tx) => {
    const failed = await tx.jobQueue.updateMany({
      where: {
        id: current.id,
        status: JobStatus.RUNNING,
        workerId: observed.workerId,
      },
      data: {
        status: JobStatus.FAILED,
        finishedAt: now,
        lastError: ORPHANED_WORKER_ERROR,
      },
    });

    if (failed.count === 0) {
      return {
        updated: false,
        retryJob: null as JobReconcileRepairRetryJob | null,
      };
    }

    if (!decision.retryQueued || decision.retryDelayMinutes === null) {
      return {
        updated: true,
        retryJob: null as JobReconcileRepairRetryJob | null,
      };
    }

    const runAfter = new Date(now.getTime() + decision.retryDelayMinutes * 60_000);
    const retryJob = await tx.jobQueue.create({
      data: {
        userId: current.userId,
        type: current.type,
        payload: current.payload as unknown as Prisma.InputJsonValue,
        status: JobStatus.PENDING,
        runAfter,
        idempotencyKey: current.idempotencyKey,
        attempts: current.attempts,
      },
      select: {
        id: true,
        userId: true,
        type: true,
        runAfter: true,
      },
    });

    return {
      updated: true,
      retryJob: {
        id: retryJob.id,
        userId: retryJob.userId,
        type: retryJob.type,
        runAfter: retryJob.runAfter.toISOString(),
      },
    };
  });

  return {
    id: current.id,
    userId: current.userId,
    type: current.type,
    previousStatus: JobStatus.RUNNING,
    action: "MARK_FAILED",
    updated: repaired.updated,
    retryQueued: repaired.retryJob !== null,
    retryJob: repaired.retryJob,
    message: repaired.updated
      ? "Orphaned RUNNING job was marked FAILED."
      : "Job changed before repair could update it.",
  };
}

function summarizeRepairItems(
  inspectedOrphanedRunningJobsCount: number,
  items: JobReconcileRepairItem[],
  canceledCyberCampusAutoLearnRetryCount: number,
): JobReconcileRepairSummary {
  return {
    inspectedOrphanedRunningJobsCount,
    repairedJobsCount: items.filter((item) => item.updated).length,
    requeuedJobsCount: items.filter((item) => item.updated && item.action === "REQUEUE").length,
    failedJobsCount: items.filter((item) => item.updated && item.action === "MARK_FAILED").length,
    retryQueuedCount: items.filter((item) => item.retryQueued).length,
    canceledCyberCampusAutoLearnRetryCount,
    skippedJobsCount: items.filter((item) => !item.updated).length,
  };
}

async function cancelCyberCampusAutoLearnRetryJobs(now: Date): Promise<number> {
  const updated = await prisma.jobQueue.updateMany({
    where: {
      status: JobStatus.PENDING,
      type: JobType.AUTOLEARN,
      attempts: { gt: 0 },
      payload: {
        path: ["provider"],
        equals: "CYBER_CAMPUS",
      },
    },
    data: {
      status: JobStatus.CANCELED,
      startedAt: null,
      workerId: null,
      finishedAt: now,
      lastError: "CYBER_CAMPUS_AUTOLEARN_RETRY_NOT_SUPPORTED",
    },
  });

  return updated.count;
}

export async function repairOrphanedRunningJobs(): Promise<JobReconcileRepairResult> {
  const before = await getJobReconcileResult();
  const checkedAt = new Date().toISOString();

  if (!before.canReconcileWithGitHub) {
    return {
      checkedAt,
      canReconcileWithGitHub: false,
      before,
      summary: summarizeRepairItems(before.orphanedRunningJobs.length, [], 0),
      repairedJobs: [],
      skippedJobs: [],
      error: before.error ?? "GITHUB_RECONCILE_UNAVAILABLE",
    };
  }

  const now = new Date();
  const items: JobReconcileRepairItem[] = [];
  for (const orphanedJob of before.orphanedRunningJobs) {
    items.push(await repairOrphanedRunningJob(orphanedJob, now));
  }
  const canceledCyberCampusAutoLearnRetryCount = await cancelCyberCampusAutoLearnRetryJobs(now);

  return {
    checkedAt,
    canReconcileWithGitHub: true,
    before,
    summary: summarizeRepairItems(
      before.orphanedRunningJobs.length,
      items,
      canceledCyberCampusAutoLearnRetryCount,
    ),
    repairedJobs: items.filter((item) => item.updated),
    skippedJobs: items.filter((item) => !item.updated),
  };
}
