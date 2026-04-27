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

test("admin approval onboarding replaces invite-token schema state", () => {
  const schema = readRepoFile("prisma/schema.prisma");

  assert.match(schema, /enum\s+UserApprovalStatus\s*{\s*PENDING\s+APPROVED\s+REJECTED\s*}/s);
  assert.match(schema, /approvalStatus\s+UserApprovalStatus\s+@default\(APPROVED\)/);
  assert.match(schema, /approvalRequestedAt\s+DateTime\?/);
  assert.match(schema, /approvalDecidedAt\s+DateTime\?/);
  assert.match(schema, /approvalDecidedByUserId\s+String\?/);
  assert.match(schema, /approvalRejectedReason\s+String\?/);
  assert.doesNotMatch(schema, /model\s+InviteToken\b/);
  assert.doesNotMatch(schema, /\bcreatedInvites\b|\binviteUsages\b/);
});

test("first portal login creates pending inactive users without storing the submitted portal password", () => {
  const loginRoute = readRepoFile("apps/web/app/api/auth/login/route.ts");
  const pendingCreate = loginRoute.match(/prisma\.user\.create\({[\s\S]*?approvalStatus:\s*"PENDING"[\s\S]*?}\),/);

  assert.ok(pendingCreate, "login route should create a pending user for first-login portal accounts");
  assert.match(pendingCreate[0], /isActive:\s*false/);
  assert.match(pendingCreate[0], /role:\s*"USER"/);
  assert.match(pendingCreate[0], /approvalRequestedAt:\s*requestedAt/);
  assert.match(pendingCreate[0], /passwordHash:\s*await hashPassword\(generateToken\(\d+\)\)/);
  assert.doesNotMatch(pendingCreate[0], /cu12Password|upsertCu12Account|setSessionCookie/);
  assert.match(loginRoute, /stage:\s*"APPROVAL_PENDING"/);
  assert.match(loginRoute, /Account approval request was rejected\.",\s*403,\s*"APPROVAL_REJECTED"/);
});

test("admin approval endpoint controls approval state separately from active toggles", () => {
  const approvalRoute = readRepoFile("apps/web/app/api/admin/members/[userId]/approval/route.ts");
  const memberRoute = readRepoFile("apps/web/app/api/admin/members/[userId]/route.ts");

  assert.match(approvalRoute, /approvalStatus:\s*"APPROVED"/);
  assert.match(approvalRoute, /isActive:\s*true/);
  assert.match(approvalRoute, /approvalDecidedByUserId:\s*context\.actor\.userId/);
  assert.match(approvalRoute, /approvalStatus:\s*"REJECTED"/);
  assert.match(approvalRoute, /isActive:\s*false/);
  assert.match(approvalRoute, /approvalRejectedReason:\s*body\.reason\s*\?\?\s*null/);
  assert.match(memberRoute, /body\.isActive\s*===\s*true\s*&&\s*user\.approvalStatus\s*!==\s*"APPROVED"/);
  assert.match(memberRoute, /MEMBER_APPROVAL_REQUIRED/);
});

test("admin approval mail queues only subscribed approved admins and excludes secrets", () => {
  const mailQueue = readRepoFile("apps/web/src/server/admin-approval-mail.ts");
  const workerMail = readRepoFile("apps/worker/src/mail-content.ts");

  assert.match(mailQueue, /role:\s*"ADMIN"/);
  assert.match(mailQueue, /isActive:\s*true/);
  assert.match(mailQueue, /approvalStatus:\s*"APPROVED"/);
  assert.match(mailQueue, /mailSubs:\s*{\s*where:\s*{\s*enabled:\s*true\s*}/s);
  assert.match(mailQueue, /mailKind:\s*"ADMIN_APPROVAL_REQUEST"/);
  assert.doesNotMatch(mailQueue, /cu12Password|encryptedPassword|cookie|tokenHash|passwordHash/);

  assert.match(workerMail, /export function buildAdminApprovalRequestMail/);
  assert.match(workerMail, /\/admin/);
  assert.doesNotMatch(workerMail, /cu12Password|encryptedPassword|cookie|tokenHash|passwordHash/);
});
