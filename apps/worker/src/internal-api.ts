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
  };
  attempts: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const env = getEnv();
  const response = await fetch(`${env.WEB_INTERNAL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-token": env.WORKER_SHARED_TOKEN,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Internal API failed ${response.status}: ${txt}`);
  }

  return (await response.json()) as T;
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

export async function finishJob(jobId: string, result: unknown) {
  await post("/internal/worker/job/finish", { jobId, result });
}

export async function failJob(jobId: string, error: string) {
  await post("/internal/worker/job/fail", { jobId, error });
}

export async function progressJob(jobId: string, result: unknown) {
  await post("/internal/worker/job/progress", { jobId, result });
}
