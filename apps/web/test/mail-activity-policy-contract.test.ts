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

test("mail preferences default to action-required mail without daily digest", () => {
  const schema = readRepoFile("prisma/schema.prisma");
  const webPreferenceRoute = readRepoFile("apps/web/app/api/mail/preferences/route.ts");
  const bootstrapRoute = readRepoFile("apps/web/app/api/dashboard/bootstrap/route.ts");
  const syncStore = readRepoFile("apps/worker/src/sync-store.ts");
  const backfill = readRepoFile("scripts/db-backfill-auth-policy-columns.mjs");

  assert.match(schema, /alertOnNotice\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /digestEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(webPreferenceRoute, /alertOnNotice:\s*false/);
  assert.match(webPreferenceRoute, /digestEnabled:\s*false/);
  assert.match(bootstrapRoute, /alertOnNotice:\s*false/);
  assert.match(bootstrapRoute, /digestEnabled:\s*false/);
  assert.match(syncStore, /alertOnNotice:\s*false/);
  assert.match(syncStore, /digestEnabled:\s*false/);
  assert.match(backfill, /"alertOnNotice"\s*=\s*false/);
  assert.match(backfill, /"digestEnabled"\s*=\s*false/);
});

test("sync mail only sends deadline alerts and digest scheduling is disabled", () => {
  const worker = readRepoFile("apps/worker/src/index.ts");
  const dispatcher = readRepoFile("apps/worker/src/queue-dispatch.ts");
  const digestWorkflowPath = path.join(repoRoot, ".github", "workflows", "mail-digest-schedule.yml");

  assert.match(worker, /const thresholdSet = new Set\(\[1,\s*0\]\)/);
  assert.match(worker, /newNotices:\s*\[\]/);
  assert.match(worker, /newUnreadNotifications:\s*\[\]/);
  assert.match(worker, /newMessages:\s*\[\]/);
  assert.match(worker, /reason:\s*"DIGEST_DISABLED"/);
  assert.doesNotMatch(worker, /sendAutoLearnStartMail/);
  assert.match(dispatcher, /if \(type === JobType\.MAIL_DIGEST\) \{\s*return \[\];\s*\}/s);
  assert.equal(fs.existsSync(digestWorkflowPath), false);
});

test("dashboard activity API is accessed from notification center only", () => {
  const activityRoute = readRepoFile("apps/web/app/api/dashboard/activity/route.ts");
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const mobileNav = readRepoFile("apps/web/components/layout/app-mobile-nav.tsx");
  const activityCenter = readRepoFile("apps/web/components/notifications/activity-center.tsx");
  const openapi = readRepoFile("docs/04-api/openapi.yaml");

  assert.match(activityRoute, /export async function GET/);
  assert.match(activityRoute, /export async function PATCH/);
  assert.match(activityRoute, /getActivity/);
  assert.match(activityCenter, /\/api\/dashboard\/activity\?limit=80/);
  assert.doesNotMatch(dashboard, /id="activity"/);
  assert.doesNotMatch(dashboard, /id="messages"/);
  assert.doesNotMatch(mobileNav, /dashboard#activity/);
  assert.doesNotMatch(mobileNav, /dashboard#messages/);
  assert.match(openapi, /\/api\/dashboard\/activity:/);
  assert.match(openapi, /DashboardActivityItem:/);
});

test("dashboard and admin pages use common topbar without legacy button override", () => {
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const notificationCenter = readRepoFile("apps/web/components/notifications/notification-center.tsx");
  const css = readRepoFile("apps/web/app/globals.css");
  const pageFiles = [
    "apps/web/app/dashboard/dashboard-client.tsx",
    "apps/web/app/admin/admin-client.tsx",
    "apps/web/app/admin/system/system-client.tsx",
    "apps/web/app/admin/site-notices/site-notices-client.tsx",
    "apps/web/app/admin/operations/operations-client.tsx",
  ].map(readRepoFile);

  assert.match(topbar, /export function AppTopbar/);
  for (const file of pageFiles) {
    assert.match(file, /<AppTopbar/);
    assert.doesNotMatch(file, /<header className="topbar"/);
  }
  assert.match(notificationCenter, /mode\?: "popover" \| "sheet"/);
  assert.match(css, /button:not\(\[data-slot="button"\]\)/);
  assert.doesNotMatch(css, /\.btn,\s*button\s*\{/);
});
