import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { getEnv } from "./env";

function stableDigest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isWorkerAuthorized(request: NextRequest): boolean {
  const token = request.headers.get("x-worker-token");
  if (!token) return false;
  const expected = getEnv().WORKER_SHARED_TOKEN;
  return timingSafeEqual(stableDigest(token), stableDigest(expected));
}
