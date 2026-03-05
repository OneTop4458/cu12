import { JobStatus } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { parseGitHubRunIdFromWorkerId } from "@/server/github-actions-dispatch";

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

export interface JobReconcileResult {
  checkedAt: string;
  canReconcileWithGitHub: boolean;
  summary: JobReconcileSummary;
  runningJobs: JobReconcileDbItem[];
  orphanedRunningJobs: JobReconcileDbItem[];
  activeRuns: JobReconcileGhRun[];
  ghostRuns: JobReconcileGhRun[];
  error?: string;
}

function isActiveWorkflowRun(status: string): boolean {
  return status !== "completed";
}

function formatDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
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
        orphanedRunningJobsCount: runningJobSummaries.length,
        activeRunsCount: 0,
        ghostRunsCount: 0,
        nonparseableWorkerIdCount,
      },
      runningJobs: runningJobSummaries,
      orphanedRunningJobs: runningJobSummaries,
      activeRuns: [],
      ghostRuns: [],
      error: "GITHUB_RUN_LIST_NOT_CONFIGURED",
    };
  }

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
        orphanedRunningJobsCount: runningJobSummaries.length,
        activeRunsCount: 0,
        ghostRunsCount: 0,
        nonparseableWorkerIdCount,
      },
      runningJobs: runningJobSummaries,
      orphanedRunningJobs: runningJobSummaries,
      activeRuns: [],
      ghostRuns: [],
      error: error instanceof Error ? error.message : "GITHUB_RUN_LIST_FAILED",
    };
  }
}
