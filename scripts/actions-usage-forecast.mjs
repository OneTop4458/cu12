import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function measureRunJobs(run, jobs, now = new Date()) {
  let completedMinutes = 0;
  let runningMinutes = 0;
  const starts = [];
  for (const job of jobs) {
    const start = Date.parse(job.started_at ?? "");
    if (!Number.isFinite(start)) continue;
    starts.push(start);
    const end = job.completed_at ? Date.parse(job.completed_at) : now.getTime();
    const minutes = Math.max(0, end - start) / 60_000;
    if (!Number.isFinite(minutes)) continue;
    if (job.completed_at) completedMinutes += minutes;
    else if (job.status === "in_progress") runningMinutes += minutes;
  }
  return {
    completedMinutes,
    runningMinutes,
    initialWaitSeconds: starts.length ? Math.max(0, Math.min(...starts) - Date.parse(run.created_at)) / 1000 : null,
  };
}

async function main() {
  const { GH_TOKEN: token, GITHUB_OWNER: owner, GITHUB_REPO: repo } = process.env;
  if (!token || !owner || !repo) throw new Error("Missing Actions reporting context");
  const api = async (suffix) => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${suffix}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Actions report API failed: HTTP ${response.status}`);
    return response.json();
  };
  const metadata = await api("");
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const runs = [];
  let total = 0;
  for (let page = 1; page <= 10; page += 1) {
    const data = await api(`/actions/runs?created=${encodeURIComponent(">=" + since)}&per_page=100&page=${page}`);
    total = data.total_count;
    runs.push(...data.workflow_runs);
    if (data.workflow_runs.length < 100) break;
  }
  // Bound report API work as application usage grows. Never label the sample as a total.
  const sample = runs.slice(0, 200);
  const groups = new Map();
  for (const run of sample) {
    const jobs = [];
    for (let page = 1; ; page += 1) {
      const data = await api(`/actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`);
      jobs.push(...data.jobs);
      if (data.jobs.length < 100) break;
    }
    const measured = measureRunJobs(run, jobs, now);
    const group = groups.get(run.name) ?? { count: 0, completed: 0, running: 0, waits: [] };
    group.count += 1;
    group.completed += measured.completedMinutes;
    group.running += measured.runningMinutes;
    if (measured.initialWaitSeconds !== null) group.waits.push(measured.initialWaitSeconds);
    groups.set(run.name, group);
  }
  const lines = [
    "## Actions capacity sample", "",
    metadata.private
      ? "Private repository: consult billing for charges; this report measures runner time."
      : "Public repository: standard hosted runner minutes are free. This is runtime, not billing.",
    `Runs created since ${since}: API reports ${total}; listed ${runs.length}; sampled ${sample.length} most recent runs (including PRs).`,
    "All available job attempts within sampled runs are included. In-progress runtime is provisional. Runs created before this window are excluded.",
    "Initial wait includes workflow startup; it is not the application job-queue wait. Later dependent jobs are not counted as initial wait.", "",
    "| Workflow | Sampled runs | Completed job minutes | Running minutes | Initial wait P95 (s) |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [name, group] of groups) {
    group.waits.sort((a, b) => a - b);
    const p95 = group.waits.length ? group.waits[Math.ceil(group.waits.length * 0.95) - 1].toFixed(1) : "n/a";
    lines.push(`| ${name.replaceAll("|", "/")} | ${group.count} | ${group.completed.toFixed(1)} | ${group.running.toFixed(1)} | ${p95} |`);
  }
  const summary = lines.join("\n") + "\n";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
