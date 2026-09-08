import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function planDeployment({ sha, previousSha, changedFiles, force = false }) {
  const deploy = force || previousSha !== sha;
  const dbChanged = deploy && (force || !previousSha || changedFiles.some((file) =>
    file.startsWith("prisma/") || /^scripts\/db-[^/]+\.mjs$/.test(file)
    || /^\.github\/workflows\/(deploy-vercel|db-bootstrap|manual-db-push)\.yml$/.test(file)));
  return { deploy, dbChanged };
}

export async function findPreviousDeployment(fetchPage, fetchJobs, currentRunId) {
  for (let page = 1; ; page += 1) {
    const runs = await fetchPage(page);
    for (const run of runs) {
      if (String(run.id) === String(currentRunId)) continue;
      const jobs = await fetchJobs(run.id);
      if (jobs.some((job) => job.name === "deploy" && job.conclusion === "success")) return run.head_sha;
    }
    if (runs.length < 100) return null;
  }
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GH_TOKEN: token } = process.env;
  if (!repo || !token || !/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Missing deployment context");
  if (process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Production deployment requires main");
  const api = async (suffix) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${suffix}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub deployment lookup failed: HTTP ${response.status}`);
    return response.json();
  };
  const previousSha = await findPreviousDeployment(
    async (page) => (await api(`actions/workflows/deploy-vercel.yml/runs?branch=main&status=success&per_page=100&page=${page}`)).workflow_runs,
    async (id) => (await api(`actions/runs/${id}/jobs?per_page=100`)).jobs,
    process.env.GITHUB_RUN_ID,
  );
  if (previousSha && !/^[a-f0-9]{40}$/.test(previousSha)) throw new Error("Invalid deployment commit");
  const changedFiles = previousSha
    ? execFileSync("git", ["diff", "--name-only", previousSha, sha], { encoding: "utf8" }).trim().split("\n")
    : [];
  const plan = planDeployment({ sha, previousSha, changedFiles, force: process.env.FORCE_DEPLOY === "true" });
  appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${plan.deploy}\ndb_changed=${plan.dbChanged}\n`, "utf8");
  console.log(JSON.stringify({ ...plan, commit: sha, previousDeployment: previousSha }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
