import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.join(repoRoot, "apps", "web");
const nextBinCandidates = [
  path.join(repoRoot, "node_modules", "next", "dist", "bin", "next"),
  path.join(workspaceRoot, "node_modules", "next", "dist", "bin", "next"),
];
const nextBin = nextBinCandidates.find((candidate) => existsSync(candidate));

if (!nextBin) {
  console.error("Unable to locate the Next.js CLI binary.");
  process.exit(1);
}

const gitMetadataPath = path.join(repoRoot, ".git");
const isLinkedWorktree = existsSync(gitMetadataPath) && !statSync(gitMetadataPath).isDirectory();
const env = { ...process.env };

if (env.CODEX_THREAD_ID && isLinkedWorktree && env.NEXT_TURBOPACK_USE_WORKER === undefined) {
  env.NEXT_TURBOPACK_USE_WORKER = "0";
}

const nextArgs = process.argv.slice(2);
const args = nextArgs.length > 0 ? nextArgs : ["build"];
const result = spawnSync(process.execPath, [nextBin, ...args], {
  cwd: workspaceRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);