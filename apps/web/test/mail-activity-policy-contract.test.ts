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
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const activityCenter = readRepoFile("apps/web/components/notifications/activity-center.tsx");
  const openapi = readRepoFile("docs/04-api/openapi.yaml");
  const mobileNavPath = path.join(repoRoot, "apps", "web", "components", "layout", "app-mobile-nav.tsx");

  assert.match(activityRoute, /export async function GET/);
  assert.match(activityRoute, /export async function PATCH/);
  assert.match(activityRoute, /getActivity/);
  assert.match(activityRoute, /markAll:\s*z\.literal\(true\)\.optional\(\)/);
  assert.match(activityRoute, /prisma\.courseNotice\.updateMany\(\{[\s\S]+?isRead:\s*false[\s\S]+?prisma\.notificationEvent\.updateMany\(\{[\s\S]+?isUnread:\s*true[\s\S]+?prisma\.portalMessage\.updateMany\(\{[\s\S]+?isRead:\s*false/);
  assert.match(activityCenter, /\/api\/dashboard\/activity\?limit=80/);
  assert.match(activityCenter, /JSON\.stringify\(\{ markAll: true \}\)/);
  assert.doesNotMatch(activityCenter, /targetItems|onClearVisible|latest\.map\(\(item\) => item\.id\)/);
  assert.match(topbar, /<ActivityCenter \/>/);
  assert.doesNotMatch(dashboard, /id="activity"/);
  assert.doesNotMatch(dashboard, /id="messages"/);
  assert.equal(fs.existsSync(mobileNavPath), false);
  assert.match(openapi, /\/api\/dashboard\/activity:/);
  assert.match(openapi, /markAll:/);
  assert.match(openapi, /updatedCount:/);
  assert.match(openapi, /DashboardActivityItem:/);
});

test("dashboard and admin pages use common topbar without legacy button override", () => {
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const notificationCenter = readRepoFile("apps/web/components/notifications/notification-center.tsx");
  const siteNoticeCenter = readRepoFile("apps/web/components/layout/site-notice-center.tsx");
  const css = readRepoFile("apps/web/app/globals.css");
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const adminPageFiles = [
    "apps/web/app/admin/admin-client.tsx",
    "apps/web/app/admin/system/system-client.tsx",
    "apps/web/app/admin/site-notices/site-notices-client.tsx",
    "apps/web/app/admin/operations/operations-client.tsx",
  ].map(readRepoFile);
  const pageFiles = [dashboard, ...adminPageFiles];

  assert.match(topbar, /export function AppTopbar/);
  for (const file of pageFiles) {
    assert.match(file, /<AppTopbar/);
    assert.doesNotMatch(file, /<header className="topbar"/);
    assert.doesNotMatch(file, /navLinks=/);
    assert.doesNotMatch(file, /refreshing=/);
    assert.doesNotMatch(file, /onRefresh=/);
    assert.doesNotMatch(file, /includeAdmin=/);
    assert.doesNotMatch(file, /mode="(?:dashboard|admin)"/);
  }
  for (const file of adminPageFiles) {
    assert.match(file, /showAdminNav/);
  }
  assert.doesNotMatch(dashboard, /showAdminNav/);
  assert.match(topbar, /ADMIN_TOPBAR_LINKS/);
  assert.match(topbar, /href: "\/admin\/site-notices"/);
  assert.match(topbar, /className=\{`topbar-admin-link/);
  assert.match(topbar, /<SessionActivityGuard variant="chip" \/>/);
  assert.match(topbar, /<SiteNoticeCenter \/>/);
  assert.doesNotMatch(topbar, /AppMobileNav|AppTopbarLink|MoreHorizontal|RefreshCw|DropdownMenu|dashboard-site-notice-host|topbar-status/);
  assert.doesNotMatch(topbar, /includeAdmin|navLinks|refreshing|onRefresh/);
  assert.match(siteNoticeCenter, /\/api\/site-notices\?surface=TOPBAR/);
  assert.doesNotMatch(siteNoticeCenter, /sessionStorage|topbar-dismissed|DISMISSED_NOTICE_KEY|readDismissedNoticeIds|writeDismissedNoticeIds/);
  assert.match(notificationCenter, /mode\?: "popover" \| "sheet"/);
  assert.match(css, /button:not\(\[data-slot="button"\]\)/);
  assert.match(css, /\.session-chip \{/);
  assert.match(css, /\.site-notice-trigger/);
  assert.match(css, /\.site-notice-popover/);
  assert.match(css, /\.topbar-admin-nav \{/);
  assert.match(css, /\.topbar-admin-link/);
  assert.match(css, /\.topbar \{[\s\S]+?background: var\(--cuk-black\);[\s\S]+?\.topbar-main \{[\s\S]+?width: min\(1280px, calc\(100% - 48px\)\);/);
  assert.doesNotMatch(css, /\.btn,\s*button\s*\{/);
  assert.doesNotMatch(css, /dashboard-page|mobile-nav-trigger|app-mobile-nav|topbar-menu-trigger|icon-btn|topbar-status/);
});

test("mobile topbar, notification sheet, and link buttons keep readable responsive sizing", () => {
  const css = readRepoFile("apps/web/app/globals.css").replace(/\r\n/g, "\n");
  const themeProvider = readRepoFile("apps/web/components/theme/theme-provider.tsx");
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const layout = readRepoFile("apps/web/app/layout.tsx");
  const login = readRepoFile("apps/web/app/login/page.tsx");
  const dashboardPage = readRepoFile("apps/web/app/dashboard/page.tsx");
  const dashboardLoading = readRepoFile("apps/web/app/dashboard/loading.tsx");
  const dashboard = readRepoFile("apps/web/app/dashboard/dashboard-client.tsx");
  const siteNoticesRoute = readRepoFile("apps/web/app/api/site-notices/route.ts");
  const openapi = readRepoFile("docs/04-api/openapi.yaml");

  assert.match(css, /\.btn,\n\.ghost-btn,\n\.btn-quiet,\n\.btn-success,\n\.btn-danger,\nbutton:not\(\[data-slot="button"\]\) \{/);
  assert.match(themeProvider, /classList\.remove\("dark"\)/);
  assert.match(themeProvider, /classList\.add\("light"\)/);
  assert.match(themeProvider, /colorScheme = "light"/);
  assert.doesNotMatch(topbar, /ThemeToggle/);
  assert.doesNotMatch(login, /ThemeToggle/);
  assert.doesNotMatch(css, /theme-toggle/);
  assert.doesNotMatch(css, /auth-public-nav/);
  assert.doesNotMatch(css, /brand-wordmark/);
  assert.doesNotMatch(layout, /SessionActivityGuard/);
  assert.match(topbar, /SessionActivityGuard/);
  assert.doesNotMatch(topbar, /dashboard-site-notice-host|const isDashboard|AppMobileNav|onRefresh|navLinks/);
  assert.doesNotMatch(dashboardPage, /dashboard-page/);
  assert.doesNotMatch(dashboardLoading, /dashboard-page/);
  assert.doesNotMatch(dashboard, /siteNoticeHost|siteNoticePortal|createPortal|dashboard-site-notice-host/);
  assert.match(dashboard, /grid-kpi provider-kpi/);
  assert.doesNotMatch(login, /CU12 AUTO/);
  assert.doesNotMatch(login, /auth-public-nav/);
  assert.doesNotMatch(login, /brand-wordmark/);
  assert.match(login, /titleLineOne/);
  assert.match(login, /<br \/>/);
  assert.match(css, /\.auth-stage \{[\s\S]+?align-items: start;/);
  assert.match(css, /\.auth-brand \{[\s\S]+?height: min\(680px, calc\(100dvh - 180px\)\);[\s\S]+?min-height: 520px;/);
  assert.match(css, /\.auth-card \{[\s\S]+?align-self: start;/);
  assert.match(css, /\.login-notice-body \{[\s\S]+?max-height: min\(220px, 34dvh\);[\s\S]+?overflow: auto;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]+?\.topbar-actions \{[\s\S]+?flex-wrap: wrap;[\s\S]+?overflow: visible;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]+?\.notification-sheet \{[\s\S]+?width: calc\(100vw - 16px\);[\s\S]+?height: calc\(100dvh - 16px\);/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]+?\.site-notice-sheet \{[\s\S]+?width: calc\(100vw - 16px\);[\s\S]+?height: calc\(100dvh - 16px\);/);
  assert.match(css, /\.notification-list-item \{[\s\S]+?height: auto;[\s\S]+?min-height: 72px;/);
  assert.match(siteNoticesRoute, /surface:\s*z\.enum\(SITE_NOTICE_SURFACES\)\.optional\(\)/);
  assert.match(siteNoticesRoute, /listPublicSiteNotices\(parsed\.data\.type,\s*\{\s*surface:\s*parsed\.data\.surface\s*\}\)/);
  assert.match(openapi, /name: surface/);
  assert.match(openapi, /enum: \[LOGIN, TOPBAR\]/);
});

test("admin subpages rely on topbar navigation without duplicate body shortcut cards", () => {
  const topbar = readRepoFile("apps/web/components/layout/app-topbar.tsx");
  const system = readRepoFile("apps/web/app/admin/system/system-client.tsx");
  const operations = readRepoFile("apps/web/app/admin/operations/operations-client.tsx");

  assert.match(topbar, /href: "\/admin\/operations\/jobs"/);
  assert.match(topbar, /href: "\/admin\/system\/policies"/);
  assert.doesNotMatch(system, /href=\{?"\/admin\/system|href=\{?"\/admin\/system\/policies|href=\{?"\/admin\/site-notices/);
  assert.doesNotMatch(operations, /\/admin\/operations\/jobs|\/admin\/operations\/workers|\/admin\/operations\/reconcile|\/admin\/operations\/cleanup/);
  assert.doesNotMatch(operations, /작업 목록 열기|워커 목록 열기|정합성 점검 열기|정리 페이지 열기/);
});

test("login page surfaces expired-session copy when the idle cookie has expired", () => {
  const login = readRepoFile("apps/web/app/login/page.tsx");

  assert.match(login, /cookies\(\)/);
  assert.match(login, /SESSION_COOKIE_NAME/);
  assert.match(login, /hasSessionCookie/);
  assert.match(login, /effectiveSessionExpiredReason/);
  assert.match(login, /!session && hasSessionCookie \? "session-expired"/);
});
