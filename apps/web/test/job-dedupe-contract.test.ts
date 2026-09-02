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

test("web and scheduled enqueue share insert-first active dedupe", () => {
  const webQueue = readRepoFile("apps/web/src/server/queue.ts");
  const workerDispatch = readRepoFile("apps/worker/src/queue-dispatch.ts");
  const enqueueSection = webQueue.slice(
    webQueue.indexOf("export async function enqueueJob"),
    webQueue.indexOf("export async function ensureSyncAllowedForUser"),
  );

  assert.match(enqueueSection, /insertActiveJobOrGetExisting\(\{/);
  assert.ok(enqueueSection.indexOf("insert:") < enqueueSection.indexOf("findActive:"));
  assert.doesNotMatch(enqueueSection, /if \(input\.idempotencyKey\)[\s\S]*?findFirst/);
  assert.match(workerDispatch, /insertActiveJobOrGetExisting\(\{/);
  assert.match(workerDispatch, /skippedExistingCount \+= 1/);
  assert.doesNotMatch(workerDispatch, /status: \{ in: \[JobStatus\.PENDING, JobStatus\.RUNNING\] \},\s*idempotencyKey: key/);
});

test("terminal and reactivation paths maintain active dedupe lifecycle", () => {
  const queue = readRepoFile("apps/web/src/server/queue.ts");
  const reconcile = readRepoFile("apps/web/src/server/jobs-reconcile.ts");
  const cyberWeb = readRepoFile("apps/web/src/server/cyber-campus-autolearn.ts");
  const cyberWorker = readRepoFile("apps/worker/src/cyber-campus-approval.ts");
  const syncStore = readRepoFile("apps/worker/src/sync-store.ts");
  const withdrawal = readRepoFile("apps/web/app/api/admin/members/[userId]/route.ts");

  for (const source of [queue, reconcile, cyberWeb, cyberWorker, syncStore, withdrawal]) {
    const terminalWrites = source.match(/status:\s*(?:JobStatus\.)?(?:SUCCEEDED|FAILED|CANCELED)|status:\s*"(?:SUCCEEDED|FAILED|CANCELED)"/g) ?? [];
    assert.ok(terminalWrites.length > 0);
  }

  assert.match(queue, /status: JobStatus\.SUCCEEDED,\s*activeDedupeKey: null/);
  assert.match(queue, /status: JobStatus\.FAILED,\s*activeDedupeKey: null/);
  assert.match(queue, /status: JobStatus\.CANCELED,\s*activeDedupeKey: null/);
  assert.match(reconcile, /status: JobStatus\.FAILED,\s*activeDedupeKey: null/);
  assert.match(reconcile, /status: JobStatus\.CANCELED,\s*activeDedupeKey: null/);
  assert.match(cyberWeb, /status: JobStatus\.FAILED,\s*activeDedupeKey: null/);
  assert.match(cyberWorker, /status: JobStatus\.CANCELED,\s*activeDedupeKey: null/);
  assert.match(syncStore, /status: "SUCCEEDED",\s*activeDedupeKey: null/);
  assert.match(syncStore, /status: "FAILED",\s*activeDedupeKey: null/);
  assert.match(syncStore, /status: "CANCELED",\s*activeDedupeKey: null/);
  assert.match(withdrawal, /status: "CANCELED",\s*activeDedupeKey: null/);

  assert.match(queue, /status: JobStatus\.PENDING,\s*activeDedupeKey: buildActiveJobDedupeKey/);
  assert.match(reconcile, /status: JobStatus\.PENDING,\s*activeDedupeKey: buildActiveJobDedupeKey/);
  assert.match(cyberWorker, /status: JobStatus\.RUNNING,\s*activeDedupeKey: buildActiveJobDedupeKey/);
  assert.match(syncStore, /status: "PENDING",\s*activeDedupeKey: buildActiveJobDedupeKey/);
});

test("retry and continuation transitions resolve active-key conflicts inside their transaction", () => {
  const queue = readRepoFile("apps/web/src/server/queue.ts");
  const reconcile = readRepoFile("apps/web/src/server/jobs-reconcile.ts");

  assert.match(queue, /status: JobStatus\.SUCCEEDED,[\s\S]*?activeDedupeKey: null[\s\S]*?tx\.jobQueue\.upsert\(\{/);
  assert.match(queue, /status: JobStatus\.FAILED,[\s\S]*?activeDedupeKey: null[\s\S]*?tx\.jobQueue\.upsert\(\{/);
  assert.match(reconcile, /status: JobStatus\.FAILED,[\s\S]*?activeDedupeKey: null[\s\S]*?tx\.jobQueue\.upsert\(\{/);
});

test("public job APIs omit the internal active dedupe key", () => {
  const queue = readRepoFile("apps/web/src/server/queue.ts");
  const adminJobs = readRepoFile("apps/web/app/api/admin/jobs/route.ts");

  assert.match(queue, /omit: \{ activeDedupeKey: true \}/);
  assert.doesNotMatch(adminJobs, /activeDedupeKey:\s*true/);
});
