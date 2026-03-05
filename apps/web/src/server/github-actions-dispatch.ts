import { getEnv } from "@/lib/env";

export type WorkerDispatchType = "sync" | "autolearn";
export type WorkerDispatchState = "DISPATCHED" | "NOT_CONFIGURED" | "FAILED" | "SKIPPED_DUPLICATE";
export type WorkerRunCancelState = "REQUESTED" | "NOT_CONFIGURED" | "NOT_APPLICABLE" | "FAILED";

export interface WorkerDispatchResult {
  state: WorkerDispatchState;
  dispatched: boolean;
  errorCode: string | null;
  error?: string;
  statusCode?: number;
}

export interface WorkerRunCancelResult {
  state: WorkerRunCancelState;
  runId: number | null;
  errorCode: string | null;
  error?: string;
  statusCode?: number;
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

export async function dispatchWorkerRun(type: WorkerDispatchType, userId?: string): Promise<WorkerDispatchResult> {
  const env = getEnv();
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_WORKFLOW_ID || !env.GITHUB_TOKEN) {
    return {
      state: "NOT_CONFIGURED",
      dispatched: false,
      errorCode: "GITHUB_DISPATCH_NOT_CONFIGURED",
      error: "GITHUB_DISPATCH_NOT_CONFIGURED",
    };
  }

  const apiUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_ID}/dispatches`;

  const payload: Record<string, unknown> = {
    ref: env.GITHUB_WORKFLOW_REF,
    inputs: {
      trigger: type,
    },
  };

  if (userId) {
    (payload.inputs as Record<string, string>).userId = userId;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
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
