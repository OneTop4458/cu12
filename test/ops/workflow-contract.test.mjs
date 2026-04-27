import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function readRepoJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

function assertContainsInOrder(content, snippets, label) {
  let cursor = 0;

  for (const snippet of snippets) {
    const next = content.indexOf(snippet, cursor);
    assert.notEqual(next, -1, `${label} is missing expected snippet: ${snippet}`);
    cursor = next + snippet.length;
  }
}

function assertDoesNotContain(content, snippet, label) {
  assert.equal(content.includes(snippet), false, `${label} must not contain snippet: ${snippet}`);
}

function normalizePathPattern(pattern) {
  return pattern
    .trim()
    .replace(/^-\s*/, "")
    .replace(/^"(.*)"$/, "$1")
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "");
}

function extractDeployWorkflowPaths(content) {
  const match = content.match(/paths:\n((?:\s+- .+\n)+)/);
  assert.ok(match, "deploy workflow should declare push paths");

  return match[1]
    .trim()
    .split("\n")
    .map((line) => normalizePathPattern(line))
    .sort();
}

function extractDispatchDeployPaths(content) {
  const match = content.match(/should_deploy=false[\s\S]+?case "\$path" in\s*\n\s*([^)]+)\)\s*\n\s*should_deploy=true/s);
  assert.ok(match, "auto-merge workflow should declare deploy dispatch paths");

  return match[1]
    .split("|")
    .map((pattern) => normalizePathPattern(pattern))
    .sort();
}

test("deploy workflow trigger paths stay aligned with post-merge deploy dispatch", () => {
  const deployWorkflow = readRepoFile(".github/workflows/deploy-vercel.yml");
  const autoMergeWorkflow = readRepoFile(".github/workflows/codex-auto-merge-on-approval.yml");

  const expectedPaths = [
    ".github/workflows/deploy-vercel.yml",
    ".npmrc",
    "apps/web",
    "apps/worker",
    "package.json",
    "packages",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prisma",
    "scripts",
    "tsconfig.base.json",
  ].sort();

  assert.deepEqual(extractDeployWorkflowPaths(deployWorkflow), expectedPaths);
  assert.deepEqual(extractDispatchDeployPaths(autoMergeWorkflow), expectedPaths);
});

test("db sync workflows keep the guarded prisma push sequence", () => {
  const requiredSequence = [
    "DATABASE_URL: ${{ secrets.DATABASE_URL }}",
    "pnpm install --frozen-lockfile",
    "pnpm run prisma:generate",
    "node scripts/db-ensure-auth-policy-constraints.mjs",
    "node scripts/db-drop-invite-token.mjs",
    "pnpm exec prisma db push --schema prisma/schema.prisma",
    "node scripts/db-backfill-auth-policy-columns.mjs",
  ];

  const workflows = [
    ".github/workflows/db-bootstrap.yml",
    ".github/workflows/manual-db-push.yml",
    ".github/workflows/deploy-vercel.yml",
  ];

  for (const workflowPath of workflows) {
    assertContainsInOrder(readRepoFile(workflowPath), requiredSequence, workflowPath);
  }
});

test("db sync workflows do not auto-reset site notice display targets", () => {
  const workflows = [
    ".github/workflows/db-bootstrap.yml",
    ".github/workflows/manual-db-push.yml",
    ".github/workflows/deploy-vercel.yml",
  ];

  for (const workflowPath of workflows) {
    const content = readRepoFile(workflowPath);
    assertDoesNotContain(content, "Backfill site notice display targets after schema sync", workflowPath);
    assertDoesNotContain(content, "pnpm run site-notices:backfill-display-target", workflowPath);
  }
});

test("autolearn dispatch keeps the stale pending drain check", () => {
  assertContainsInOrder(
    readRepoFile(".github/workflows/autolearn-dispatch.yml"),
    [
      "CREATED_COUNT=$(node -e",
      "PENDING_COUNT=$(node -e",
      "SHOULD_DISPATCH=false",
      'if [ "$CREATED_COUNT" != "0" ] || [ "$PENDING_COUNT" != "0" ]; then',
      "SHOULD_DISPATCH=true",
      'elif [ -z "${{ inputs.userId }}" ]; then',
      "SHOULD_DISPATCH=true",
      'if [ "$SHOULD_DISPATCH" = "true" ]; then',
      'TARGET_URL="${WEB_INTERNAL_BASE_URL%/}/internal/worker/dispatch"',
    ],
    ".github/workflows/autolearn-dispatch.yml",
  );
});

test("root test scripts include web, worker, ops, and all-test gates", () => {
  const rootPackage = readRepoJson("package.json");
  const workerPackage = readRepoJson("apps/worker/package.json");

  assert.equal(workerPackage.scripts["test:unit"], "tsx --test src/*.test.ts");
  assert.equal(rootPackage.scripts["test:web"], "corepack pnpm --filter @cu12/web run test:auth");
  assert.equal(rootPackage.scripts["test:worker"], "corepack pnpm --filter @cu12/worker run test:unit");
  assert.equal(rootPackage.scripts["test:ops"], "node --test test/ops/*.test.mjs");
  assertContainsInOrder(
    rootPackage.scripts["test:all"],
    ["corepack pnpm run test:web", "corepack pnpm run test:worker", "corepack pnpm run test:ops"],
    "package.json test:all",
  );
});

test("ci, deploy verify, and ai ship run all tests before build or deploy", () => {
  const releaseGateSequence = [
    "pnpm run check:text",
    "pnpm run check:openapi",
    "pnpm run prisma:generate",
    "pnpm run typecheck",
    "pnpm run test:all",
    "pnpm run build:web",
  ];

  assertContainsInOrder(readRepoFile(".github/workflows/ci.yml"), releaseGateSequence, "ci.yml");
  assertContainsInOrder(readRepoFile(".github/workflows/deploy-vercel.yml"), releaseGateSequence, "deploy-vercel.yml");
  assertContainsInOrder(readRepoFile("scripts/ai-pr.ps1"), releaseGateSequence, "scripts/ai-pr.ps1");

  const deployWorkflow = readRepoFile(".github/workflows/deploy-vercel.yml");
  assertContainsInOrder(deployWorkflow, ['db-sync:', 'needs: verify', 'deploy:', 'needs: db-sync'], "deploy-vercel.yml job ordering");
});

test("AGENTS documents all-test validation before PR creation", () => {
  const agents = readRepoFile("AGENTS.md");

  assertContainsInOrder(
    agents,
    [
      "pnpm run prisma:generate",
      "pnpm run check:text",
      "pnpm run check:openapi",
      "pnpm run typecheck",
      "pnpm run test:all",
      "pnpm run build:web",
    ],
    "AGENTS.md required local validation",
  );
  assertContainsInOrder(
    agents,
    [
      "`pnpm run typecheck`",
      "`pnpm run test:all`",
      "`pnpm run build:web`",
    ],
    "AGENTS.md operator execution rule",
  );
});

test("invite-code onboarding routes are removed from the public API contract", () => {
  const openApi = readRepoFile("docs/04-api/openapi.yaml");

  assertDoesNotContain(openApi, "/api/auth/login/invite", "OpenAPI");
  assertDoesNotContain(openApi, "/api/auth/invite", "OpenAPI");
  assertDoesNotContain(openApi, "LoginInviteRequired", "OpenAPI");
  assertDoesNotContain(openApi, "InviteToken:", "OpenAPI");
  assert.equal(fs.existsSync(path.join(repoRoot, "apps/web/app/api/auth/login/invite/route.ts")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "apps/web/app/api/auth/invite/route.ts")), false);
});
