const token = process.env.GH_TOKEN;
const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const includedMinutes = Number(process.env.ACTIONS_INCLUDED_MINUTES ?? "2000");

if (!token || !owner || !repo) {
  throw new Error("Missing GH_TOKEN, GITHUB_OWNER, or GITHUB_REPO");
}

function monthBounds(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

async function fetchRuns(page) {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/actions/runs`);
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("exclude_pull_requests", "true");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API failed (${response.status}): ${text}`);
  }

  return response.json();
}

function runDurationMinutes(run) {
  if (!run.created_at || !run.updated_at) return 0;
  const created = new Date(run.created_at).getTime();
  const updated = new Date(run.updated_at).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated) || updated <= created) return 0;
  return (updated - created) / 60000;
}

async function main() {
  const now = new Date();
  const { start, end } = monthBounds(now);

  let page = 1;
  let totalMinutes = 0;
  let runCount = 0;
  let reachedBeforeMonth = false;

  while (!reachedBeforeMonth && page <= 10) {
    const payload = await fetchRuns(page);
    const runs = payload.workflow_runs ?? [];
    if (runs.length === 0) break;

    for (const run of runs) {
      const createdAt = run.created_at ? new Date(run.created_at) : null;
      if (!createdAt) continue;

      if (createdAt < start) {
        reachedBeforeMonth = true;
        continue;
      }

      if (createdAt >= end) continue;
      if (run.status !== "completed") continue;

      totalMinutes += runDurationMinutes(run);
      runCount += 1;
    }

    page += 1;
  }

  const elapsedMs = Math.max(1, now.getTime() - start.getTime());
  const monthMs = end.getTime() - start.getTime();
  const projectedMinutes = totalMinutes * (monthMs / elapsedMs);
  const utilizationPct = (projectedMinutes / includedMinutes) * 100;

  const lines = [
    `Actions usage forecast for ${owner}/${repo}`,
    `- Month UTC window: ${start.toISOString()} ~ ${end.toISOString()}`,
    `- Included minutes: ${includedMinutes}`,
    `- Measured completed runs: ${runCount}`,
    `- Current month consumed minutes (estimate): ${totalMinutes.toFixed(1)}`,
    `- End-of-month forecast minutes: ${projectedMinutes.toFixed(1)} (${utilizationPct.toFixed(1)}%)`,
  ];

  if (utilizationPct >= 95) {
    lines.push("- Risk level: HIGH (>=95%)");
  } else if (utilizationPct >= 80) {
    lines.push("- Risk level: MEDIUM (>=80%)");
  } else {
    lines.push("- Risk level: LOW (<80%)");
  }

  console.log(lines.join("\n"));

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const markdown = [
      "## Actions Usage Forecast",
      "",
      `- Repository: \`${owner}/${repo}\``,
      `- Month (UTC): \`${start.toISOString()}\` to \`${end.toISOString()}\``,
      `- Included minutes: **${includedMinutes}**`,
      `- Completed runs measured: **${runCount}**`,
      `- Current month consumed minutes: **${totalMinutes.toFixed(1)}**`,
      `- Forecast at month end: **${projectedMinutes.toFixed(1)}** (**${utilizationPct.toFixed(1)}%**)`,
      "",
    ].join("\n");
    await import("node:fs/promises").then((fs) => fs.appendFile(summaryPath, `${markdown}\n`, "utf8"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
