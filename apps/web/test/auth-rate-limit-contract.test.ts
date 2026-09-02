import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("production failure recording uses a parameterized PostgreSQL atomic upsert", () => {
  const source = readRepoFile("apps/web/src/server/auth-rate-limit.ts");

  assert.match(source, /\$transaction\(async \(tx\)/);
  assert.match(source, /tx\.\$queryRaw<AuthRateLimitRecord\[]>\(Prisma\.sql`/);
  assert.match(source, /INSERT INTO "AuthRateLimit" AS rate_limit/);
  assert.match(source, /ON CONFLICT \("key"\) DO UPDATE SET/);
  assert.match(source, /rate_limit\."failCount" \+ 1/);
  assert.match(source, /RETURNING rate_limit\."blockedUntil"/);
  assert.doesNotMatch(source, /\$queryRawUnsafe|\$executeRawUnsafe/);
});

test("login fails closed with a sanitized 503 when rate-limit storage is unavailable", () => {
  const route = readRepoFile("apps/web/app/api/auth/login/route.ts");
  const bestEffort = readRepoFile("apps/web/src/server/auth-best-effort.ts");
  const openApi = readRepoFile("docs/04-api/openapi.yaml");

  assert.match(route, /error instanceof AuthRateLimitUnavailableError/);
  assert.match(
    route,
    /"Authentication protection is temporarily unavailable\."[\s\S]*?503,[\s\S]*?"AUTH_RATE_LIMIT_UNAVAILABLE"/,
  );
  assert.doesNotMatch(bestEffort, /checkAuthThrottleBestEffort|recordAuthFailureBestEffort|clearAuthFailuresBestEffort/);
  assert.match(openApi, /"503":\r?\n\s+description: [^\r\n]*login protection/i);
});
