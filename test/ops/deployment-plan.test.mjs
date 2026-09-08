import assert from "node:assert/strict";
import test from "node:test";
import { findPreviousDeployment, planDeployment } from "../../scripts/deployment-plan.mjs";

test("duplicate successful commits skip deployment while explicit forced redeploy remains available", () => {
  assert.deepEqual(planDeployment({ sha: "one", previousSha: "one", changedFiles: [] }), { deploy: false, dbChanged: false });
  assert.deepEqual(planDeployment({ sha: "one", previousSha: "one", changedFiles: [], force: true }), { deploy: true, dbChanged: true });
});

test("schema decisions span every change since the last actual deployment", () => {
  for (const file of ["prisma/schema.prisma", "scripts/db-backfill-auth-policy-columns.mjs", ".github/workflows/deploy-vercel.yml"]) {
    assert.equal(planDeployment({ sha: "new", previousSha: "old", changedFiles: ["apps/web/page.tsx", file] }).dbChanged, true);
  }
  assert.deepEqual(planDeployment({ sha: "new", previousSha: "old", changedFiles: ["apps/web/page.tsx"] }), { deploy: true, dbChanged: false });
  assert.equal(planDeployment({ sha: "new", previousSha: null, changedFiles: [] }).dbChanged, true);
});

test("skipped duplicate runs do not become the last deployed commit", async () => {
  const result = await findPreviousDeployment(
    async () => [{ id: 3, head_sha: "skipped" }, { id: 2, head_sha: "deployed" }],
    async (id) => [{ name: "deploy", conclusion: id === 2 ? "success" : "skipped" }],
    4,
  );
  assert.equal(result, "deployed");
});

test("deployment history continues beyond the first page", async () => {
  const result = await findPreviousDeployment(
    async (page) => page === 1 ? Array.from({ length: 100 }, (_, id) => ({ id, head_sha: "skipped" })) : [{ id: 101, head_sha: "deployed" }],
    async (id) => [{ name: "deploy", conclusion: id === 101 ? "success" : "skipped" }],
    200,
  );
  assert.equal(result, "deployed");
});
