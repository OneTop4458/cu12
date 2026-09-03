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

test("admin member sync sends the JSON object required by the route parser", () => {
  const client = readRepoFile("apps/web/app/admin/admin-client.tsx");
  const syncMember = client.slice(
    client.indexOf("const syncMember"),
    client.indexOf("const toggleMemberActive"),
  );
  const route = readRepoFile("apps/web/app/api/admin/members/[userId]/sync/route.ts");

  assert.match(route, /parseBody\(request, SyncRequestSchema\)/);
  assert.match(syncMember, /method:\s*"POST",\s*body:\s*JSON\.stringify\(\{\}\)/);
});
