import assert from "node:assert/strict";
import test from "node:test";
import { measureRunJobs } from "../../scripts/actions-usage-forecast.mjs";

test("capacity counts parallel job minutes without billing workflow wait or dependency delay", () => {
  const measured = measureRunJobs({ created_at: "2026-09-08T00:00:00Z" }, [
    { started_at: "2026-09-08T00:01:00Z", completed_at: "2026-09-08T00:03:00Z" },
    { started_at: "2026-09-08T00:01:00Z", completed_at: "2026-09-08T00:03:00Z" },
    { started_at: "2026-09-08T00:05:00Z", completed_at: "2026-09-08T00:06:00Z" },
    { status: "skipped", started_at: null, completed_at: null },
  ]);
  assert.deepEqual(measured, { completedMinutes: 5, runningMinutes: 0, initialWaitSeconds: 60 });
});

test("running jobs are provisional and never mixed into completed runtime", () => {
  assert.deepEqual(measureRunJobs({ created_at: "2026-09-08T00:00:00Z" }, [
    { status: "in_progress", started_at: "2026-09-08T00:01:00Z", completed_at: null },
  ], new Date("2026-09-08T00:04:00Z")), { completedMinutes: 0, runningMinutes: 3, initialWaitSeconds: 60 });
});
