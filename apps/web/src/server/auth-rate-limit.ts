import { createHmac } from "node:crypto";
import {
  AUTH_RATE_LIMIT_BLOCK_MS,
  AUTH_RATE_LIMIT_MAX_FAILURES,
  AUTH_RATE_LIMIT_WINDOW_MS,
} from "@cu12/core";
import { Prisma } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const STORAGE_RETRY_DELAYS_MS = [25] as const;
const DIGEST_DOMAIN = "cu12-auth-rate-limit:v1";

export type AuthScope = "login";

export interface AuthThrottleStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

export interface AuthRateLimitBucket {
  key: string;
  identifier: string;
}

interface AuthRateLimitRecordInput {
  scope: AuthScope;
  buckets: AuthRateLimitBucket[];
  now: Date;
  windowStartCutoff: Date;
  blockedUntil: Date;
  maxFailures: number;
}

interface AuthRateLimitRecord {
  blockedUntil: Date | null;
}

export interface AuthRateLimitStore {
  findBlocked(keys: string[]): Promise<AuthRateLimitRecord[]>;
  recordFailures(input: AuthRateLimitRecordInput): Promise<AuthRateLimitRecord[]>;
  clear(keys: string[]): Promise<void>;
}

interface AuthRateLimiterOptions {
  store: AuthRateLimitStore;
  readSecret: () => string;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
}

export class AuthRateLimitUnavailableError extends Error {
  constructor() {
    super("Authentication protection is temporarily unavailable.");
    this.name = "AuthRateLimitUnavailableError";
  }
}

function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

function readDigestSecret(readSecret: () => string): string {
  try {
    const secret = readSecret();
    if (secret.length < 32) {
      throw new AuthRateLimitUnavailableError();
    }
    return secret;
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      throw error;
    }
    throw new AuthRateLimitUnavailableError();
  }
}

export function deriveAuthRateLimitBucket(
  scope: AuthScope,
  rawIdentifier: string,
  secret: string,
): AuthRateLimitBucket {
  if (secret.length < 32) {
    throw new AuthRateLimitUnavailableError();
  }

  const digest = createHmac("sha256", secret)
    .update(DIGEST_DOMAIN)
    .update("\0")
    .update(scope)
    .update("\0")
    .update(rawIdentifier)
    .digest("hex");

  return {
    key: `${scope}:v1:${digest}`,
    identifier: `hmac-sha256:${digest}`,
  };
}

function resolveBuckets(
  scope: AuthScope,
  identifiers: Array<string | null | undefined>,
  readSecret: () => string,
): AuthRateLimitBucket[] {
  const normalized = Array.from(
    new Set(
      identifiers
        .map(normalizeIdentifier)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  if (normalized.length === 0) return [];

  const secret = readDigestSecret(readSecret);
  return normalized
    .map((identifier) => deriveAuthRateLimitBucket(scope, identifier, secret))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function retryAfterSeconds(blockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000));
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runRequiredStorageOperation<T>(
  operation: () => Promise<T>,
  sleep: (delayMs: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; attempt <= STORAGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch {
      const delayMs = STORAGE_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        throw new AuthRateLimitUnavailableError();
      }
      await sleep(delayMs);
    }
  }

  throw new AuthRateLimitUnavailableError();
}

export function createAuthRateLimiter(options: AuthRateLimiterOptions) {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;

  return {
    async checkAuthThrottle(
      scope: AuthScope,
      identifiers: Array<string | null | undefined>,
    ): Promise<AuthThrottleStatus> {
      const buckets = resolveBuckets(scope, identifiers, options.readSecret);
      if (buckets.length === 0) return { blocked: false, retryAfterSeconds: 0 };

      const checkedAt = now();
      const records = await runRequiredStorageOperation(
        () => options.store.findBlocked(buckets.map((bucket) => bucket.key)),
        sleep,
      );
      const maxRetryAfter = records.reduce((maximum, record) => {
        if (!record.blockedUntil || record.blockedUntil.getTime() <= checkedAt.getTime()) {
          return maximum;
        }
        return Math.max(maximum, retryAfterSeconds(record.blockedUntil, checkedAt));
      }, 0);

      return {
        blocked: maxRetryAfter > 0,
        retryAfterSeconds: maxRetryAfter,
      };
    },

    async recordAuthFailure(
      scope: AuthScope,
      identifiers: Array<string | null | undefined>,
    ): Promise<AuthThrottleStatus> {
      const buckets = resolveBuckets(scope, identifiers, options.readSecret);
      if (buckets.length === 0) return { blocked: false, retryAfterSeconds: 0 };

      const recordedAt = now();
      const records = await runRequiredStorageOperation(
        () => options.store.recordFailures({
          scope,
          buckets,
          now: recordedAt,
          windowStartCutoff: new Date(recordedAt.getTime() - AUTH_RATE_LIMIT_WINDOW_MS),
          blockedUntil: new Date(recordedAt.getTime() + AUTH_RATE_LIMIT_BLOCK_MS),
          maxFailures: AUTH_RATE_LIMIT_MAX_FAILURES,
        }),
        sleep,
      );
      const maxRetryAfter = records.reduce((maximum, record) => {
        if (!record.blockedUntil) return maximum;
        return Math.max(maximum, retryAfterSeconds(record.blockedUntil, recordedAt));
      }, 0);

      return {
        blocked: maxRetryAfter > 0,
        retryAfterSeconds: maxRetryAfter,
      };
    },

    async clearAuthFailures(
      scope: AuthScope,
      identifiers: Array<string | null | undefined>,
    ): Promise<void> {
      const buckets = resolveBuckets(scope, identifiers, options.readSecret);
      if (buckets.length === 0) return;
      await runRequiredStorageOperation(
        () => options.store.clear(buckets.map((bucket) => bucket.key)),
        sleep,
      );
    },
  };
}

const prismaAuthRateLimitStore: AuthRateLimitStore = {
  async findBlocked(keys) {
    return prisma.authRateLimit.findMany({
      where: { key: { in: keys } },
      select: { blockedUntil: true },
    });
  },

  async recordFailures(input) {
    return prisma.$transaction(async (tx) => {
      const records: AuthRateLimitRecord[] = [];

      for (const bucket of input.buckets) {
        const rows = await tx.$queryRaw<AuthRateLimitRecord[]>(Prisma.sql`
          INSERT INTO "AuthRateLimit" AS rate_limit (
            "key",
            "scope",
            "identifier",
            "failCount",
            "windowStart",
            "blockedUntil",
            "createdAt",
            "updatedAt"
          ) VALUES (
            ${bucket.key},
            ${input.scope},
            ${bucket.identifier},
            1,
            ${input.now},
            NULL,
            ${input.now},
            ${input.now}
          )
          ON CONFLICT ("key") DO UPDATE SET
            "scope" = EXCLUDED."scope",
            "identifier" = EXCLUDED."identifier",
            "failCount" = CASE
              WHEN rate_limit."windowStart" >= ${input.windowStartCutoff}
                THEN rate_limit."failCount" + 1
              ELSE 1
            END,
            "windowStart" = CASE
              WHEN rate_limit."windowStart" >= ${input.windowStartCutoff}
                THEN rate_limit."windowStart"
              ELSE ${input.now}
            END,
            "blockedUntil" = CASE
              WHEN (
                CASE
                  WHEN rate_limit."windowStart" >= ${input.windowStartCutoff}
                    THEN rate_limit."failCount" + 1
                  ELSE 1
                END
              ) >= ${input.maxFailures}
                THEN ${input.blockedUntil}
              ELSE NULL
            END,
            "updatedAt" = ${input.now}
          RETURNING rate_limit."blockedUntil"
        `);
        const record = rows[0];
        if (!record) {
          throw new Error("Auth rate limit update returned no row.");
        }
        records.push(record);
      }

      return records;
    });
  },

  async clear(keys) {
    await prisma.authRateLimit.deleteMany({
      where: { key: { in: keys } },
    });
  },
};

const authRateLimiter = createAuthRateLimiter({
  store: prismaAuthRateLimitStore,
  readSecret: () => getEnv().AUTH_JWT_SECRET,
});

export const checkAuthThrottle = authRateLimiter.checkAuthThrottle;
export const recordAuthFailure = authRateLimiter.recordAuthFailure;
export const clearAuthFailures = authRateLimiter.clearAuthFailures;
