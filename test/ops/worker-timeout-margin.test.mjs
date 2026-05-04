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

test("cyber campus autolearn chunk leaves at least 30 minutes before workflow timeout", () => {
  const workflow = readRepoFile(".github/workflows/worker-consume.yml");
  const timeoutMatch = workflow.match(/timeout-minutes:\s*(\d+)/);
  const chunkMatch = workflow.match(/CYBER_CAMPUS_AUTOLEARN_CHUNK_TARGET_SECONDS:\s*(\d+)/);

  assert.ok(timeoutMatch, "worker-consume.yml should declare timeout-minutes");
  assert.ok(chunkMatch, "worker-consume.yml should declare CYBER_CAMPUS_AUTOLEARN_CHUNK_TARGET_SECONDS");

  const workflowTimeoutSeconds = Number(timeoutMatch[1]) * 60;
  const cyberCampusChunkSeconds = Number(chunkMatch[1]);

  assert.equal(cyberCampusChunkSeconds, 19_800);
  assert.ok(
    workflowTimeoutSeconds - cyberCampusChunkSeconds >= 1_800,
    "Cyber Campus chunk target should leave at least 30 minutes for setup and cleanup",
  );
});
