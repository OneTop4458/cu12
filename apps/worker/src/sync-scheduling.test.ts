import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { loadSyncSchedules } from "./sync-scheduling";

test("schedule policy is provider-scoped and keeps deadline checks even after a fresh autolearn snapshot", async (t) => {
  const original = prisma.user.findMany;
  const now = new Date();
  Reflect.set(prisma.user, "findMany", async () => [{
    id: "one",
    cu12Account: { campus: "SONGSIM", autoLearnEnabled: false, detectActivitiesEnabled: false, emailDigestEnabled: false },
    courseSnapshots: [{ provider: "CU12" }],
    mailSubs: [],
    learningTasks: [],
    providerSyncStates: [{ provider: "CU12", lastFullSyncAt: now }],
  }, {
    id: "two",
    cu12Account: { campus: null, autoLearnEnabled: true, detectActivitiesEnabled: true, emailDigestEnabled: true },
    courseSnapshots: [],
    mailSubs: [{ alertOnDeadline: true }],
    learningTasks: [{ provider: "CYBER_CAMPUS" }],
    providerSyncStates: [{ provider: "CYBER_CAMPUS", lastFullSyncAt: now }],
  }]);
  t.after(() => Reflect.set(prisma.user, "findMany", original));
  const schedules = await loadSyncSchedules(["one", "two"], 720);
  assert.equal(schedules.get("one:CU12")?.intervalMinutes, 720);
  assert.equal(schedules.get("one:CYBER_CAMPUS")?.intervalMinutes, 1440);
  assert.equal(schedules.get("one:CU12")?.lastFullSyncAt, now);
  assert.equal(schedules.get("one:CYBER_CAMPUS")?.lastFullSyncAt, null);
  assert.equal(schedules.get("two:CYBER_CAMPUS")?.intervalMinutes, 0);
});
