import { NextRequest } from "next/server";
import { getEnv } from "./env";

export function isWorkerAuthorized(request: NextRequest): boolean {
  const token = request.headers.get("x-worker-token");
  if (!token) return false;
  return token === getEnv().WORKER_SHARED_TOKEN;
}
