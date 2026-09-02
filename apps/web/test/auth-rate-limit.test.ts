import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_RATE_LIMIT_MAX_FAILURES } from "@cu12/core";
import {
  AuthRateLimitUnavailableError,
  createAuthRateLimiter,
  type AuthRateLimitStore,
} from "../src/server/auth-rate-limit";

const SECRET = "rate-limit-test-secret-32-characters-minimum";
const NOW = new Date("2026-09-02T12:00:00.000Z");

function createMemoryStore() {
  const rows = new Map<string, {
    scope: string;
    identifier: string;
    failCount: number;
    windowStart: Date;
    blockedUntil: Date | null;
  }>();
  let tail = Promise.resolve();

  function synchronized<T>(work: () => T): Promise<T> {
    const result = tail.then(work, work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  const store: AuthRateLimitStore = {
    async findBlocked(keys) {
      return keys
        .map((key) => rows.get(key))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => ({ blockedUntil: row.blockedUntil }));
    },

    recordFailures(input) {
      return synchronized(() => input.buckets.map((bucket) => {
        const current = rows.get(bucket.key);
        const inWindow = Boolean(current && current.windowStart >= input.windowStartCutoff);
        const failCount = inWindow ? current!.failCount + 1 : 1;
        const row = {
          scope: input.scope,
          identifier: bucket.identifier,
          failCount,
          windowStart: inWindow ? current!.windowStart : input.now,
          blockedUntil: failCount >= input.maxFailures ? input.blockedUntil : null,
        };
        rows.set(bucket.key, row);
        return { blockedUntil: row.blockedUntil };
      }));
    },

    async clear(keys) {
      for (const key of keys) rows.delete(key);
    },
  };

  return { store, rows };
}

function createTestLimiter(store: AuthRateLimitStore, readSecret = () => SECRET) {
  return createAuthRateLimiter({
    store,
    readSecret,
    now: () => NOW,
    sleep: async () => undefined,
  });
}

test("parallel first insert and updates count every failure and block on the eighth attempt", async () => {
  const memory = createMemoryStore();
  const limiter = createTestLimiter(memory.store);
  const identifiers = ["ip:203.0.113.10", "portal:student-2026"];

  const results = await Promise.all(
    Array.from({ length: AUTH_RATE_LIMIT_MAX_FAILURES }, () =>
      limiter.recordAuthFailure("login", identifiers)),
  );

  assert.equal(results.slice(0, -1).every((result) => !result.blocked), true);
  assert.equal(results.at(-1)?.blocked, true);
  assert.equal(results.at(-1)?.retryAfterSeconds, 15 * 60);
  assert.equal(memory.rows.size, 2);
  for (const row of memory.rows.values()) {
    assert.equal(row.failCount, AUTH_RATE_LIMIT_MAX_FAILURES);
  }
  assert.deepEqual(await limiter.checkAuthThrottle("login", identifiers), {
    blocked: true,
    retryAfterSeconds: 15 * 60,
  });
});

test("stored bucket keys and identifiers are deterministic digests without raw portal ids or ips", async () => {
  const memory = createMemoryStore();
  const limiter = createTestLimiter(memory.store);
  const rawValues = ["ip:203.0.113.10", "portal:Student-2026"];

  await limiter.recordAuthFailure("login", rawValues);
  const firstKeys = [...memory.rows.keys()];
  const firstRows = [...memory.rows.values()];
  await limiter.clearAuthFailures("login", rawValues);
  await limiter.recordAuthFailure("login", ["IP:203.0.113.10", "PORTAL:student-2026"]);

  assert.deepEqual([...memory.rows.keys()], firstKeys);
  for (const stored of [...memory.rows.keys(), ...firstRows.map((row) => row.identifier)]) {
    assert.match(stored, /[a-f0-9]{64}$/);
    assert.doesNotMatch(stored, /203\.0\.113\.10|student-2026/i);
  }
});

test("successful authentication reset clears every derived bucket", async () => {
  const memory = createMemoryStore();
  const limiter = createTestLimiter(memory.store);
  const identifiers = ["ip:203.0.113.10", "portal:student-2026"];

  await limiter.recordAuthFailure("login", identifiers);
  assert.equal(memory.rows.size, 2);
  await limiter.clearAuthFailures("login", identifiers);

  assert.equal(memory.rows.size, 0);
  assert.deepEqual(await limiter.checkAuthThrottle("login", identifiers), {
    blocked: false,
    retryAfterSeconds: 0,
  });
});

test("missing digest secret fails closed", async () => {
  const memory = createMemoryStore();
  const limiter = createTestLimiter(memory.store, () => "");

  await assert.rejects(
    () => limiter.checkAuthThrottle("login", ["portal:student-2026"]),
    AuthRateLimitUnavailableError,
  );
  assert.equal(memory.rows.size, 0);
});

test("storage errors receive one short retry and then fail closed", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const store: AuthRateLimitStore = {
    async findBlocked() {
      attempts += 1;
      throw new Error("storage unavailable");
    },
    async recordFailures() {
      throw new Error("storage unavailable");
    },
    async clear() {
      throw new Error("storage unavailable");
    },
  };
  const limiter = createAuthRateLimiter({
    store,
    readSecret: () => SECRET,
    now: () => NOW,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  await assert.rejects(
    () => limiter.checkAuthThrottle("login", ["portal:student-2026"]),
    AuthRateLimitUnavailableError,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [25]);
});

test("a transient storage error succeeds on the retry", async () => {
  let attempts = 0;
  const store: AuthRateLimitStore = {
    async findBlocked() {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return [];
    },
    async recordFailures() {
      return [];
    },
    async clear() {
      return undefined;
    },
  };
  const limiter = createTestLimiter(store);

  assert.deepEqual(await limiter.checkAuthThrottle("login", ["portal:student-2026"]), {
    blocked: false,
    retryAfterSeconds: 0,
  });
  assert.equal(attempts, 2);
});
