import assert from "node:assert/strict";
import test from "node:test";
import { buildPolicyUpdateMail } from "./mail-content";

const DASHBOARD_BASE_URL = "https://cu12.example.com";

test("buildPolicyUpdateMail renders current, previous, and diff links", () => {
  const mail = buildPolicyUpdateMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-09T09:00:00+09:00"),
    changes: [
      {
        title: "이용약관",
        currentVersion: 3,
        previousVersion: 2,
        currentUrl: `${DASHBOARD_BASE_URL}/terms?version=3`,
        previousUrl: `${DASHBOARD_BASE_URL}/terms?version=2`,
        diffUrl: `${DASHBOARD_BASE_URL}/terms?version=3&compareTo=2`,
      },
    ],
  });

  assert.ok(mail);
  assert.match(mail.subject, /약관 업데이트/);
  assert.match(mail.html, /terms\?version=3/);
  assert.match(mail.html, /terms\?version=2/);
  assert.match(mail.html, /compareTo=2/);
});
