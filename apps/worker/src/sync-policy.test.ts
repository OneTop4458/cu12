import assert from "node:assert/strict";
import test from "node:test";
import { buildSyncIdempotencyKey, isFullSyncFresh, resolveScheduledSyncInterval } from "@cu12/core";

const quiet = {
  minimumMinutes: 720, hasActiveCourses: false, autoLearnEnabled: false,
  detectActivitiesEnabled: false, emailDigestEnabled: false, hasImportantMail: false,
};

test("only accounts without active courses or background services use the daily interval", () => {
  assert.equal(resolveScheduledSyncInterval(quiet), 1440);
  for (const flag of ["hasActiveCourses", "autoLearnEnabled", "detectActivitiesEnabled", "emailDigestEnabled", "hasImportantMail"]) {
    assert.equal(resolveScheduledSyncInterval({ ...quiet, [flag]: true }), 720, flag);
  }
  assert.equal(resolveScheduledSyncInterval({ ...quiet, minimumMinutes: 1800 }), 1800);
});

test("full snapshot freshness uses successful collection time and preserves explicit refresh", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  assert.equal(isFullSyncFresh(null, 720, now), false);
  assert.equal(isFullSyncFresh(new Date("2026-09-08T11:00:00Z"), 720, now), true);
  assert.equal(isFullSyncFresh(new Date("2026-09-08T00:00:00Z"), 720, now), false);
  assert.equal(isFullSyncFresh(new Date("2026-09-08T11:00:00Z"), 0, now), false);
  assert.equal(isFullSyncFresh(new Date("2026-09-09T00:00:00Z"), 720, now), false);
});

test("full sync identity separates users and providers without including the trigger", () => {
  assert.equal(buildSyncIdempotencyKey("one", "CU12"), "sync:one:CU12:full");
  assert.notEqual(buildSyncIdempotencyKey("one", "CU12"), buildSyncIdempotencyKey("two", "CU12"));
  assert.notEqual(buildSyncIdempotencyKey("one", "CU12"), buildSyncIdempotencyKey("one", "CYBER_CAMPUS"));
});
