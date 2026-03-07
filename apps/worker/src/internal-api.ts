import { JobType } from "@prisma/client";
import { getEnv } from "./env";

interface ClaimedJob {
  id: string;
  type: JobType;
  payload: {
    userId: string;
    lectureSeq?: number;
    autoLearnMode?: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";
    reason?: string;
    chainSegment?: number;
    chainElapsedSeconds?: number;
  };
  attempts: number;
}

type WorkerDispatchType = "sync" | "autolearn";

interface WorkerDispatchResult {
  state: "DISPATCHED" | "NOT_CONFIGURED" | "FAILED" | "SKIPPED_DUPLICATE";
  dispatched: boolean;
  errorCode: string | null;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TypeError";
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const env = getEnv();
  const maxAttempts = env.WORKER_INTERNAL_API_MAX_RETRIES + 1;
  const url = `${env.WEB_INTERNAL_BASE_URL}${path}`;
  const payload = JSON.stringify(body);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.WORKER_INTERNAL_API_TIMEOUT_MS);
    let response: Response | null = null;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-worker-token": env.WORKER_SHARED_TOKEN,
        },
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error) || attempt >= maxAttempts) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Internal API request failed on ${path} (attempt ${attempt}/${maxAttempts}): ${message}`);
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!response) {
      await sleep(env.WORKER_INTERNAL_API_RETRY_BASE_MS * attempt);
      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const txt = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    lastError = new Error(`Internal API failed ${response.status} on ${path}: ${txt}`);
    if (!retryable || attempt >= maxAttempts) {
      throw lastError;
    }

    await sleep(env.WORKER_INTERNAL_API_RETRY_BASE_MS * attempt);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(`Internal API request failed on ${path}`);
}

export async function sendHeartbeat(workerId: string) {
  await post("/internal/worker/heartbeat", { workerId });
}

export async function claimJob(workerId: string, types: JobType[]): Promise<ClaimedJob | null> {
  const response = await post<{ job: ClaimedJob | null }>("/internal/worker/job/start", {
    workerId,
    types,
  });
  return response.job;
}

export async function finishJob(jobId: string, workerId: string, result: unknown) {
  await post("/internal/worker/job/finish", { jobId, workerId, result });
}

export async function failJob(jobId: string, workerId: string, error: string) {
  await post("/internal/worker/job/fail", { jobId, workerId, error });
}

export async function progressJob(jobId: string, workerId: string, result: unknown) {
  await post("/internal/worker/job/progress", { jobId, workerId, result });
}

export async function hasPendingJobs(types: JobType[]): Promise<boolean> {
  const response = await post<{ pending: boolean }>("/internal/worker/job/pending", { types });
  return response.pending;
}

export async function requestWorkerDispatch(trigger: WorkerDispatchType): Promise<WorkerDispatchResult> {
  return post<WorkerDispatchResult>("/internal/worker/dispatch", { trigger });
}
