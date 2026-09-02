import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

test("dashboard starts bootstrap and independent collections without a serial waterfall", () => {
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const bootstrapStart = dashboard.indexOf("const bootstrapPromise = fetchJson<DashboardBootstrap>");
  const collectionsStart = dashboard.indexOf("const collectionsPromise = refreshCollections");
  const bootstrapAwait = dashboard.indexOf("const payload = await bootstrapPromise");

  assert.ok(bootstrapStart >= 0, "bootstrap request should be created explicitly");
  assert.ok(collectionsStart > bootstrapStart, "collections should start immediately after bootstrap starts");
  assert.ok(bootstrapAwait > collectionsStart, "bootstrap-dependent state should be applied after both requests start");
  assert.doesNotMatch(dashboard, /setDashboardManualGuide[\s\S]+?void refreshCollections\(\)/);
  assert.match(dashboard, /const controller = new AbortController\(\);\s*void refreshAll\(false, \{ signal: controller\.signal \}\);\s*return \(\) => controller\.abort\(\);/);
  assert.match(dashboard, /requestInit\.cache = "no-store"/);
});

test("dashboard collection requests preserve partial providers and reject stale or aborted responses", () => {
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const providerSettledLoads = dashboard.match(/Promise\.allSettled\(\s*PORTAL_PROVIDERS\.map/g) ?? [];

  assert.ok(providerSettledLoads.length >= 2, "courses and deadlines should settle providers independently");
  assert.match(dashboard, /prev\.filter\(\(course\) => course\.provider === PORTAL_PROVIDERS\[index\]\)/);
  assert.match(dashboard, /prev\.filter\(\(deadline\) => deadline\.provider === PORTAL_PROVIDERS\[index\]\)/);
  assert.match(dashboard, /isCurrentRequest\(requestId, coursesRequestRef\.current, options\?\.signal\)/);
  assert.match(dashboard, /isCurrentRequest\(requestId, deadlinesRequestRef\.current, options\?\.signal\)/);
  assert.match(dashboard, /isCurrentRequest\(requestId, jobsRequestRef\.current, options\?\.signal\)/);
  assert.match(dashboard, /!isAbortError\(err\)/);
  assert.match(dashboard, /signal: options\?\.signal/);
});

test("activity data is lazy-loaded on first open and keeps reopen and refresh behavior", () => {
  const activityCenter = readRepoFile("apps/web/components/notifications/activity-center.tsx");
  const notificationCenter = readRepoFile("apps/web/components/notifications/notification-center.tsx");
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");

  assert.match(activityCenter, /const \[loading, setLoading\] = useState\(false\)/);
  assert.doesNotMatch(activityCenter, /void loadLatest\(true\);\s*\}, \[loadLatest\]\);/);
  assert.match(activityCenter, /if \(nextOpen\) \{\s*void loadLatest\(!latestLoaded\);/);
  assert.match(activityCenter, /unreadCount=\{latestLoaded \? undefined : Math\.max\(0, initialUnreadCount\)\}/);
  assert.match(activityCenter, /onRefresh=\{\(\) => void \(showHistory \? loadHistory\(\) : loadLatest\(true\)\)\}/);
  assert.match(activityCenter, /readActivity\("\/api\/dashboard\/activity\?limit=80", controller\.signal\)/);
  assert.match(activityCenter, /requestId !== latestRequestRef\.current/);
  assert.match(activityCenter, /latestAbortRef\.current\?\.abort\(\)/);
  assert.match(activityCenter, /historyAbortRef\.current\?\.abort\(\)/);
  assert.match(notificationCenter, /unreadCountOverride \?\? loadedUnreadCount/);
  assert.match(topbar, /<ActivityCenter initialUnreadCount=\{activityUnreadCount\} \/>/);
  assert.match(dashboard, /activityUnreadCount=\{summary\?\.unreadNoticeCount \?\? 0\}/);
});

test("session refresh waits for user activity while idle and revocation protections remain", () => {
  const guard = readRepoFile("apps/web/app/_components/session-activity-guard.tsx");

  assert.doesNotMatch(guard, /void tryRefresh\(Date\.now\(\)\)/);
  assert.doesNotMatch(guard, /setActiveStateNow\(bootstrappedAt\)/);
  assert.match(guard, /initialRemainingMs = Math\.max\(0, getIdleTimeoutMs\(\) - \(Date\.now\(\) - bootstrappedAt\)\)/);
  assert.match(guard, /lastActivityHandledAtRef\.current = 0/);
  assert.match(guard, /const registerActivity[\s\S]+?setActiveStateNow\(now\);\s*void tryRefresh\(now\);/);
  assert.match(guard, /signal: controller\.signal/);
  assert.match(guard, /refreshAbortRef\.current\?\.abort\(\)/);
  assert.match(guard, /response\.status === 401[\s\S]+?markSessionExpired\("session-expired"\)/);
  assert.match(guard, /readSessionExpiredState\(\)/);
  assert.match(guard, /event\.key === LAST_ACTIVITY_KEY/);
  assert.match(guard, /await markSessionExpired\("session-timeout"\)/);
});
