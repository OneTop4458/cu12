import { pathToFileURL } from "node:url";

export function isDeployRelevantPath(file) {
  return /^(apps\/web\/|packages\/|prisma\/)/.test(file)
    || /^scripts\/db-[^/]+\.mjs$/.test(file)
    || [
      "scripts/prisma-cli.mjs", "scripts/run-next-build.mjs", "scripts/deployment-plan.mjs",
      "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".npmrc",
      ".github/workflows/deploy-vercel.yml",
    ].includes(file);
}

export async function publishAutoMerge({ api, repo, number, expectedSha }) {
  let pull = await api("GET", `pulls/${number}`);
  const eligible = () => pull.base?.ref === "main" && pull.head?.repo?.full_name === repo
    && (!expectedSha || pull.head.sha === expectedSha);
  if (!eligible()) return "IGNORED_SOURCE";
  if (!pull.merged && pull.state === "open" && pull.auto_merge) {
    try {
      // Normal merge API enforces branch protection; never bypass checks or a changed head.
      const merged = await api("PUT", `pulls/${number}/merge`, {
        sha: pull.head.sha, merge_method: pull.auto_merge.merge_method,
      });
      if (merged.merged) pull = { ...pull, merged: true, merge_commit_sha: merged.sha };
    } catch (error) {
      if (error.status !== 405 && error.status !== 409) throw error;
      // Auto-merge may have completed concurrently, or another gate/head is not ready.
      pull = await api("GET", `pulls/${number}`);
    }
  }
  if (!eligible() || !pull.merged) return "WAITING_OR_MANUAL";
  let relevant = false;
  for (let page = 1; ; page += 1) {
    const files = await api("GET", `pulls/${number}/files?per_page=100&page=${page}`);
    relevant ||= files.some((file) => isDeployRelevantPath(file.filename));
    if (relevant || files.length < 100) break;
  }
  if (!relevant) return "NO_WEB_CHANGE";
  await api("POST", "actions/workflows/deploy-vercel.yml/dispatches", { ref: "main" });
  return "DEPLOY_REQUESTED";
}

async function main() {
  const { GH_TOKEN: token, GITHUB_REPOSITORY: repo, SOURCE_HEAD_SHA: sha, PULL_REQUEST_NUMBER: requested } = process.env;
  if (!token || !repo) throw new Error("Missing publisher context");
  const api = async (method, suffix, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${suffix}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Object.assign(new Error(`Publish API failed: HTTP ${response.status}`), { status: response.status });
    return response.status === 204 ? null : response.json();
  };
  const numbers = [];
  if (requested) {
    const number = Number(requested);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid PR number");
    numbers.push(number);
  } else {
    if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Invalid source commit");
    const pulls = await api("GET", `commits/${sha}/pulls?per_page=100`);
    numbers.push(...pulls.map((pull) => pull.number));
  }
  for (const number of numbers) {
    const state = await publishAutoMerge({ api, repo, number, expectedSha: requested ? undefined : sha });
    console.log(JSON.stringify({ pullRequest: number, state }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
