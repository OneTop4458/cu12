import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatAdminMemberLastLogin } from "../src/lib/admin-member-last-login";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("admin member API selects lastLoginAt in normal and provider fallback queries", () => {
  const route = readRepoFile("apps/web/app/api/admin/members/route.ts");
  const listRoute = route.slice(0, route.indexOf("export async function GET"));

  assert.equal(listRoute.match(/lastLoginAt:\s*true/g)?.length, 2);
  assert.doesNotMatch(listRoute, /lastLoginIp/);
});

test("admin member last login display is fixed to KST and handles missing values", () => {
  assert.equal(formatAdminMemberLastLogin(null), "로그인 이력 없음");
  assert.equal(formatAdminMemberLastLogin("invalid"), "로그인 이력 없음");
  assert.equal(
    formatAdminMemberLastLogin("2026-01-01T15:04:05.000Z"),
    "2026. 01. 02. 00:04:05",
  );

  const client = readRepoFile("apps/web/app/admin/admin-client.tsx");
  assert.match(client, /lastLoginAt:\s*string \| null/);
  assert.match(client, /<th>마지막 로그인 \(KST\)<\/th>/);
  assert.match(client, /data-label="마지막 로그인 \(KST\)"/);
  assert.match(client, /formatAdminMemberLastLogin\(member\.lastLoginAt\)/);
  assert.match(client, /<td colSpan=\{10\}>등록된 회원이 없습니다\.<\/td>/);
});

test("OpenAPI documents nullable admin member lastLoginAt without lastLoginIp", () => {
  const openapi = readRepoFile("docs/04-api/openapi.yaml").replace(/\r\n/g, "\n");
  const adminMemberSchema = openapi.slice(
    openapi.indexOf("    AdminMember:\n"),
    openapi.indexOf("    AdminMemberListResponse:\n"),
  );

  assert.match(openapi, /\/api\/admin\/members:[\s\S]*?\$ref: "#\/components\/schemas\/AdminMemberListResponse"/);
  assert.match(adminMemberSchema, /lastLoginAt:\s*\n\s*type: string\s*\n\s*format: date-time\s*\n\s*nullable: true/);
  assert.doesNotMatch(adminMemberSchema, /lastLoginIp/);
});
