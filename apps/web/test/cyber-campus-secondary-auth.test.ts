import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseCyberCampusSecondaryAuthMethods } from "@cu12/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "cyber-campus-secondary-auth-way-info.json");
const wayInfoFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

test("parseCyberCampusSecondaryAuthMethods keeps live way-info method shapes", () => {
  const methods = parseCyberCampusSecondaryAuthMethods(wayInfoFixture);

  assert.deepEqual(methods, [
    {
      way: 1,
      param: "DEVICE-1234",
      target: "iPhone 15 Pro_iOS 18.0",
      label: "HelloLMS 앱코드 인증: iPhone 15 Pro_iOS 18.0",
      requiresCode: true,
    },
    {
      way: 2,
      param: "student@example.com",
      target: "student@example.com",
      label: "이메일 인증: student@example.com",
      requiresCode: true,
    },
  ]);
});
