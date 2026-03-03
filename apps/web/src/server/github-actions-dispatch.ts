import { getEnv } from "@/lib/env";

export type WorkerDispatchType = "sync" | "autolearn";

export interface WorkerDispatchResult {
  dispatched: boolean;
  error?: string;
}

export async function dispatchWorkerRun(type: WorkerDispatchType, userId?: string): Promise<WorkerDispatchResult> {
  const env = getEnv();
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO || !env.GITHUB_WORKFLOW_ID || !env.GITHUB_TOKEN) {
    return { dispatched: false, error: "GITHUB_DISPATCH_NOT_CONFIGURED" };
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
    return { dispatched: false, error: `GITHUB_DISPATCH_FAILED:${response.status}:${text}` };
  }

  return { dispatched: true };
}
