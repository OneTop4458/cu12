import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

type AuthScope = "login" | "invite";

export interface AuthThrottleStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

function resolveKeys(scope: AuthScope, identifiers: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const raw of identifiers) {
    const identifier = normalizeIdentifier(raw);
    if (!identifier) continue;
    const key = `${scope}:${identifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function retryAfterSeconds(blockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000));
}

export async function checkAuthThrottle(scope: AuthScope, identifiers: Array<string | null | undefined>): Promise<AuthThrottleStatus> {
  const keys = resolveKeys(scope, identifiers);
  if (keys.length === 0) return { blocked: false, retryAfterSeconds: 0 };

  const now = new Date();
  const records = await prisma.authRateLimit.findMany({
    where: { key: { in: keys } },
    select: { blockedUntil: true },
  });

  let maxRetryAfter = 0;
  for (const record of records) {
    if (!record.blockedUntil) continue;
    if (record.blockedUntil.getTime() <= now.getTime()) continue;
    maxRetryAfter = Math.max(maxRetryAfter, retryAfterSeconds(record.blockedUntil, now));
  }

  return {
    blocked: maxRetryAfter > 0,
    retryAfterSeconds: maxRetryAfter,
  };
}

export async function recordAuthFailure(scope: AuthScope, identifiers: Array<string | null | undefined>): Promise<AuthThrottleStatus> {
  const keys = resolveKeys(scope, identifiers);
  if (keys.length === 0) return { blocked: false, retryAfterSeconds: 0 };

  const now = new Date();
  const windowStartCutoff = new Date(now.getTime() - WINDOW_MS);
  let maxRetryAfter = 0;

  await prisma.$transaction(async (tx) => {
    for (const key of keys) {
      const record = await tx.authRateLimit.findUnique({
        where: { key },
      });
      const identifier = key.slice(scope.length + 1);

      if (!record) {
        await tx.authRateLimit.create({
          data: {
            key,
            scope,
            identifier,
            failCount: 1,
            windowStart: now,
          },
        });
        continue;
      }

      const inWindow = record.windowStart.getTime() >= windowStartCutoff.getTime();
      const nextFailCount = inWindow ? record.failCount + 1 : 1;
      const nextWindowStart = inWindow ? record.windowStart : now;
      const shouldBlock = nextFailCount >= MAX_FAILURES;
      const nextBlockedUntil = shouldBlock ? new Date(now.getTime() + BLOCK_MS) : null;

      await tx.authRateLimit.update({
        where: { key },
        data: {
          failCount: nextFailCount,
          windowStart: nextWindowStart,
          blockedUntil: nextBlockedUntil,
        },
      });

      if (nextBlockedUntil) {
        maxRetryAfter = Math.max(maxRetryAfter, retryAfterSeconds(nextBlockedUntil, now));
      }
    }
  });

  return {
    blocked: maxRetryAfter > 0,
    retryAfterSeconds: maxRetryAfter,
  };
}

export async function clearAuthFailures(scope: AuthScope, identifiers: Array<string | null | undefined>) {
  const keys = resolveKeys(scope, identifiers);
  if (keys.length === 0) return;
  await prisma.authRateLimit.deleteMany({
    where: { key: { in: keys } },
  });
}
