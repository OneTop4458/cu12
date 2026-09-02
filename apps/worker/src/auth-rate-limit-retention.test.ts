import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AUTH_RATE_LIMIT_WINDOW_MS } from "@cu12/core";
import { buildExpiredAuthRateLimitWhere } from "./retention-policy";

test("auth rate-limit retention preserves exact window boundaries and active blocks", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const windowCutoff = new Date(now.getTime() - AUTH_RATE_LIMIT_WINDOW_MS);

  assert.deepEqual(buildExpiredAuthRateLimitWhere(now), {
    OR: [
      { blockedUntil: { lte: now } },
      {
        blockedUntil: null,
        windowStart: { lt: windowCutoff },
      },
    ],
  });
  assert.equal(windowCutoff.toISOString(), "2026-09-02T11:45:00.000Z");
});

test("retention cleanup reports only the aggregate auth rate-limit deletion count", () => {
  const source = fs.readFileSync(new URL("./retention-cleanup.ts", import.meta.url), "utf8");

  assert.match(source, /client\.authRateLimit\.deleteMany\(\{/);
  assert.match(source, /where: buildExpiredAuthRateLimitWhere\(now\)/);
  assert.match(source, /authRateLimits: authRateLimitsDeleted/);
  assert.doesNotMatch(source, /authRateLimit\.findMany|identifier:\s*true|key:\s*true/);
});
