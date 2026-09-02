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

test("web and worker stores enforce terminal scrub and keep terminal rows immutable", () => {
  for (const file of [
    "apps/web/src/server/portal-session-store.ts",
    "apps/worker/src/sync-store.ts",
  ]) {
    const source = readRepoFile(file);
    assert.match(source, /buildPortalApprovalTerminalScrub\(input\.status\)/);
    assert.match(source, /encryptedCookieState:\s*encode\w*\(terminalScrub\.cookieState\)/);
    assert.match(source, /methods:\s*Prisma\.DbNull/);
    assert.match(source, /status:\s*\{ in:\s*\[\.\.\.ACTIVE_PORTAL_APPROVAL_STATUSES\] \}/);
  }
});

test("approval completion persists the fresh PortalSession without duplicating cookies", () => {
  const source = readRepoFile("apps/worker/src/cyber-campus-approval.ts");
  const completeApproval = source.slice(
    source.indexOf("async function completeApproval"),
    source.indexOf("async function failApprovalAction"),
  );

  assert.ok(completeApproval.indexOf("upsertPortalSessionCookieState") < completeApproval.indexOf("status: \"COMPLETED\""));
  assert.match(completeApproval, /upsertPortalSessionCookieState\(\{[\s\S]*?cookieState,/);
  assert.doesNotMatch(
    completeApproval.slice(completeApproval.indexOf("updatePortalApprovalSessionStateForWorker")),
    /cookieState,/,
  );
});
