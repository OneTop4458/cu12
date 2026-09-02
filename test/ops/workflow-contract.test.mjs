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

function extractMultilineRunBlocks(content) {
  const lines = content.split("\n");
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|\s*$/);
    if (!match) continue;

    const runIndent = match[1].length;
    const blockLines = [];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex];
      const firstNonWhitespace = line.search(/\S/);
      if (firstNonWhitespace !== -1 && firstNonWhitespace <= runIndent) break;
      blockLines.push(line);
    }
    blocks.push(blockLines.join("\n"));
  }

  return blocks;
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

test("general auto-merge excludes Dependabot PRs", () => {
  const workflow = readRepoFile(".github/workflows/codex-auto-merge-on-approval.yml");

  assert.match(workflow, /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login != 'app\/dependabot'/);
  assertDoesNotContain(workflow, "is_dependabot", ".github/workflows/codex-auto-merge-on-approval.yml");
});

test("Dependabot auto-merge verifies PR source and handles rebased updates safely", () => {
  const workflow = readRepoFile(".github/workflows/dependabot-auto-review.yml");

  assertContainsInOrder(
    workflow,
    [
      "Validate Dependabot PR source",
      'new Set(["dependabot[bot]", "app/dependabot"])',
      "github.rest.pulls.get",
      "pull.head.repo?.full_name !== expectedRepo",
      '!pull.head.ref.startsWith("dependabot/")',
      "Fetch Dependabot metadata",
      "skip-commit-verification: true",
    ],
    ".github/workflows/dependabot-auto-review.yml source validation",
  );

  const prAutomationWorkflows = [
    ".github/workflows/dependabot-auto-review.yml",
    ".github/workflows/codex-auto-merge-on-approval.yml",
  ];
  for (const workflowPath of prAutomationWorkflows) {
    const ghPrLines = readRepoFile(workflowPath)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("gh pr "));
    assert.ok(ghPrLines.length > 0, `${workflowPath} should call gh pr`);
    for (const line of ghPrLines) {
      assert.match(line, /-R "\$GH_REPO"/, `gh pr call must select the repository explicitly: ${line}`);
    }
  }
});

test("Dependabot major updates disable existing auto-merge before being held", () => {
  const workflow = readRepoFile(".github/workflows/dependabot-auto-review.yml");

  assertContainsInOrder(
    workflow,
    [
      "Disable auto-merge for semver-major updates",
      "--json autoMergeRequest",
      '--disable-auto',
      "Label and hold semver-major updates",
    ],
    ".github/workflows/dependabot-auto-review.yml major update handling",
  );
});

test("web Vercel project uses the Hobby-safe Singapore region contract", () => {
  const configPath = path.join(repoRoot, "apps", "web", "vercel.json");
  const repositoryRootConfigPath = path.join(repoRoot, "vercel.json");
  const config = readRepoJson("apps/web/vercel.json");

  assert.equal(fs.existsSync(configPath), true, "apps/web/vercel.json should live in the configured Vercel Root Directory");
  assert.equal(fs.existsSync(repositoryRootConfigPath), false, "the Vercel config must not be placed above apps/web");
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "regions"]);
  assert.equal(config.$schema, "https://openapi.vercel.sh/vercel.json");
  assert.deepEqual(config.regions, ["sin1"], "Hobby deployments must use one Singapore region");
  assert.equal("functionFailoverRegions" in config, false, "Enterprise failover must stay disabled");
  assert.equal("fluid" in config, false, "this contract must not opt into Fluid Compute");
});

test("db sync workflows keep the guarded prisma push sequence", () => {
  const requiredSequence = [
    "DATABASE_URL: ${{ secrets.DATABASE_URL }}",
    "pnpm install --frozen-lockfile",
    "pnpm run prisma:generate",
    "node scripts/db-ensure-auth-policy-constraints.mjs",
    "node scripts/db-drop-invite-token.mjs",
    "pnpm exec prisma db push --schema prisma/schema.prisma",
    "node scripts/db-backfill-active-job-dedupe.mjs",
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

test("job dedupe rollout cleans active duplicates after schema sync and finalizes after deploy", () => {
  const schema = readRepoFile("prisma/schema.prisma");
  const backfill = readRepoFile("scripts/db-backfill-active-job-dedupe.mjs");
  const helper = readRepoFile("packages/core/src/job-dedupe.ts");
  const deploy = readRepoFile(".github/workflows/deploy-vercel.yml");

  assert.match(schema, /activeDedupeKey\s+String\?\s+@unique/);
  assert.match(helper, /ACTIVE_JOB_DEDUPE_SEPARATOR = "\\u001f"/);
  assert.match(helper, /\["v1", input\.userId, input\.type, input\.idempotencyKey\]\.join/);
  assert.match(backfill, /'v1', chr\(31\), "userId", chr\(31\), "type"::text, chr\(31\), "idempotencyKey"/);
  assertContainsInOrder(
    backfill,
    [
      'LOCK TABLE "JobQueue" IN ACCESS EXCLUSIVE MODE',
      'PARTITION BY "userId", "type", "idempotencyKey"',
      `CASE WHEN "status"::text = 'RUNNING' THEN 0 ELSE 1 END`,
      `"status" = 'CANCELED'`,
      `"lastError" = 'ACTIVE_DEDUPE_BACKFILL_DUPLICATE'`,
      `"activeDedupeKey" = concat(`,
      "remainingUnkeyedActiveRows",
      "remainingDuplicateGroups",
      "console.log(JSON.stringify(summary))",
    ],
    "active job dedupe backfill",
  );
  assert.doesNotMatch(backfill, /console\.(?:log|warn|error)\([^\n]*(?:userId|idempotencyKey|payload|activeDedupeKey)/);
  assert.equal(deploy.match(/node scripts\/db-backfill-active-job-dedupe\.mjs/g)?.length, 2);
  assertContainsInOrder(
    deploy,
    [
      "pnpm exec prisma db push --schema prisma/schema.prisma",
      "Backfill active job dedupe keys before deploy",
      "Deploy production bundle",
      "Finalize active job dedupe keys after deploy",
    ],
    "deploy active job dedupe rollout",
  );
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
      'elif [ -z "$INPUT_USER_ID" ]; then',
      "SHOULD_DISPATCH=true",
      'if [ "$SHOULD_DISPATCH" = "true" ]; then',
      'TARGET_URL="${WEB_INTERNAL_BASE_URL%/}/internal/worker/dispatch"',
    ],
    ".github/workflows/autolearn-dispatch.yml",
  );
});

test("reconcile health check self-repairs orphaned running jobs", () => {
  const workflow = readRepoFile(".github/workflows/reconcile-health-check.yml");

  assertContainsInOrder(
    workflow,
    [
      "async function dispatchPendingSyncWorkers",
      'body: JSON.stringify({ trigger: "sync" })',
      "workerDispatch state=",
      "worker dispatch failed after orphan repair.",
    ],
    ".github/workflows/reconcile-health-check.yml dispatch helper",
  );

  assertContainsInOrder(
    workflow,
    [
      'const payload = await requestReconcile(targetUrl, workerToken, "GET", "status check");',
      "orphaned RUNNING jobs detected; attempting internal repair.",
      'const repairPayload = await requestReconcile(targetUrl, workerToken, "POST", "orphan repair");',
      'const verifyPayload = await requestReconcile(targetUrl, workerToken, "GET", "repair verify");',
      "repair did not clear reconcile mismatch.",
      "orphan repair verified",
      "await dispatchPendingSyncWorkers(baseUrl, workerToken);",
    ],
    ".github/workflows/reconcile-health-check.yml",
  );
});

test("secret-bearing workflow scripts do not interpolate user inputs directly", () => {
  const workflows = [
    ".github/workflows/autolearn-dispatch.yml",
    ".github/workflows/worker-consume.yml",
  ];

  for (const workflowPath of workflows) {
    const runBlocks = extractMultilineRunBlocks(readRepoFile(workflowPath));
    assert.ok(runBlocks.length > 0, `${workflowPath} should contain shell run blocks`);
    for (const block of runBlocks) {
      assertDoesNotContain(block, "${{ inputs.", workflowPath);
    }
  }
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

test("db retention cleanup runs broad retention before legacy repair", () => {
  const workflow = readRepoFile(".github/workflows/db-retention-cleanup.yml");
  const workerPackage = readRepoJson("apps/worker/package.json");
  const retentionCleanup = readRepoFile("apps/worker/src/retention-cleanup.ts");
  const retentionPolicy = readRepoFile("apps/worker/src/retention-policy.ts");

  assert.equal(workerPackage.scripts["cleanup:retention"], "tsx src/retention-cleanup.ts");
  assertContainsInOrder(
    workflow,
    [
      "pnpm run prisma:generate",
      "pnpm --filter @cu12/worker run cleanup:retention",
      "Cleanup legacy notices and notifications",
    ],
    ".github/workflows/db-retention-cleanup.yml",
  );
  assert.match(retentionPolicy, /WITHDRAWN_RECORD_RETENTION_MONTHS\s*=\s*6/);
  assertContainsInOrder(
    retentionPolicy,
    [
      "const originalDayOfMonth = value.getDate();",
      "value.setDate(1);",
      "value.setMonth(value.getMonth() - months);",
      "lastDayOfTargetMonth",
      "Math.min(originalDayOfMonth, lastDayOfTargetMonth)",
    ],
    "apps/worker/src/retention-policy.ts month cutoff clamp",
  );
  assert.match(retentionCleanup, /client\.user\.deleteMany\(\{/);
  assert.match(retentionCleanup, /withdrawnAt:\s*\{\s*not:\s*null,\s*lt:\s*cutoffs\.withdrawnRecord/s);
  assert.match(retentionCleanup, /withdrawnUsers:\s*withdrawnUsersDeleted/);
  assert.match(retentionCleanup, /portalSession\.deleteMany\(\{/);
  assert.match(retentionCleanup, /portalApprovalSession\.deleteMany\(\{/);
  assert.match(retentionCleanup, /portalSessions:\s*portalSessionsDeleted/);
  assert.match(retentionCleanup, /portalApprovalSessions:\s*portalApprovalSessionsDeleted/);
  assert.doesNotMatch(retentionCleanup, /error\.message|String\(error\)/);
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
