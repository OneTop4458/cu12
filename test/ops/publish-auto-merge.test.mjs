import assert from "node:assert/strict";
import test from "node:test";
import { isDeployRelevantPath, publishAutoMerge } from "../../scripts/publish-auto-merge.mjs";

const repo = "owner/repo";
const basePull = { base: { ref: "main" }, head: { sha: "head", repo: { full_name: repo } }, state: "open", merged: false, auto_merge: null };

function mockApi(pull, options = {}) {
  const calls = [];
  let reads = 0;
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET" && path === "pulls/1") return reads++ > 0 && options.after ? options.after : pull;
    if (method === "PUT") {
      if (options.mergeError) throw Object.assign(new Error("blocked"), { status: options.mergeError });
      return { merged: true, sha: "merged" };
    }
    if (path.includes("/files")) return options.files ?? [{ filename: "apps/web/src/server/queue.ts" }];
    if (method === "POST") return null;
    throw new Error("Unexpected request");
  };
  return { api, calls };
}

test("a bot-merged PR explicitly dispatches deployment even if push/closed events were suppressed", async () => {
  const mock = mockApi({ ...basePull, merged: true, state: "closed" });
  assert.equal(await publishAutoMerge({ ...mock, repo, number: 1, expectedSha: "head" }), "DEPLOY_REQUESTED");
  assert.deepEqual(mock.calls.at(-1), { method: "POST", path: "actions/workflows/deploy-vercel.yml/dispatches", body: { ref: "main" } });
});

test("only an already enabled auto-merge is completed, using the checked head and normal merge API", async () => {
  const manual = mockApi(basePull);
  assert.equal(await publishAutoMerge({ ...manual, repo, number: 1, expectedSha: "head" }), "WAITING_OR_MANUAL");
  assert.equal(manual.calls.length, 1);
  const enabled = mockApi({ ...basePull, auto_merge: { merge_method: "squash" } });
  assert.equal(await publishAutoMerge({ ...enabled, repo, number: 1, expectedSha: "head" }), "DEPLOY_REQUESTED");
  assert.deepEqual(enabled.calls.find((call) => call.method === "PUT").body, { sha: "head", merge_method: "squash" });
});

test("forks, changed heads, and other base branches never merge or publish", async () => {
  for (const pull of [
    { ...basePull, head: { sha: "head", repo: { full_name: "fork/repo" } } },
    { ...basePull, head: { sha: "changed", repo: { full_name: repo } } },
    { ...basePull, base: { ref: "develop" } },
  ]) {
    const mock = mockApi({ ...pull, auto_merge: { merge_method: "squash" } });
    assert.equal(await publishAutoMerge({ ...mock, repo, number: 1, expectedSha: "head" }), "IGNORED_SOURCE");
    assert.equal(mock.calls.length, 1);
  }
});

test("unfinished protection gates wait for the next check event without publishing", async () => {
  const mock = mockApi({ ...basePull, auto_merge: { merge_method: "squash" } }, { mergeError: 405 });
  assert.equal(await publishAutoMerge({ ...mock, repo, number: 1, expectedSha: "head" }), "WAITING_OR_MANUAL");
  assert.equal(mock.calls.some((call) => call.method === "POST"), false);
});

test("a concurrent auto-merge is detected while permission errors remain failures", async () => {
  const racing = mockApi({ ...basePull, auto_merge: { merge_method: "squash" } }, { mergeError: 405, after: { ...basePull, merged: true } });
  assert.equal(await publishAutoMerge({ ...racing, repo, number: 1, expectedSha: "head" }), "DEPLOY_REQUESTED");
  const forbidden = mockApi({ ...basePull, auto_merge: { merge_method: "squash" } }, { mergeError: 403 });
  await assert.rejects(publishAutoMerge({ ...forbidden, repo, number: 1, expectedSha: "head" }), /blocked/);
});

test("worker-only and documentation changes do not publish web", async () => {
  const mock = mockApi({ ...basePull, merged: true }, { files: [{ filename: "apps/worker/src/index.ts" }, { filename: "docs/notes.md" }] });
  assert.equal(await publishAutoMerge({ ...mock, repo, number: 1, expectedSha: "head" }), "NO_WEB_CHANGE");
  assert.equal(isDeployRelevantPath("scripts/deployment-plan.mjs"), true);
  assert.equal(isDeployRelevantPath("scripts/db-backfill-example.mjs"), true);
  assert.equal(isDeployRelevantPath("scripts/actions-usage-forecast.mjs"), false);
});
