import assert from "node:assert/strict";
import test from "node:test";
import { JobType } from "@prisma/client";
import {
  countActiveWorkerRuns,
  getRunningBlockerTypesForDispatch,
  selectPendingCandidateUsersFromRows,
} from "../src/server/github-actions-dispatch";

test("active worker capacity includes older runs and deduplicates status transitions across pages", async () => {
  const count = await countActiveWorkerRuns(async (status, page) => {
    if (status === "queued" && page === 1) return Array.from({ length: 100 }, (_, id) => ({ id, status }));
    if (status === "queued" && page === 2) return [{ id: 100, status }];
    if (status === "in_progress") return [{ id: 100, status }, { id: 101, status }];
    return [];
  });
  assert.equal(count, 102);
});

test("capacity lookup failures fail closed instead of reporting free slots", async () => {
  await assert.rejects(countActiveWorkerRuns(async () => { throw new Error("unavailable"); }), /unavailable/);
});

test("sync dispatch is not blocked by a running autolearn job for the same user", () => {
  assert.deepEqual(
    selectPendingCandidateUsersFromRows({
      types: [JobType.SYNC, JobType.NOTICE_SCAN],
      runningRows: [{ userId: "user-1", type: JobType.AUTOLEARN }],
      pendingRows: [{ userId: "user-1" }],
      limit: 5,
    }),
    ["user-1"],
  );
});

test("sync dispatch still blocks users with running sync-family jobs", () => {
  assert.deepEqual(
    selectPendingCandidateUsersFromRows({
      types: [JobType.SYNC, JobType.NOTICE_SCAN],
      runningRows: [{ userId: "user-1", type: JobType.NOTICE_SCAN }],
      pendingRows: [{ userId: "user-1" }, { userId: "user-2" }],
      limit: 5,
    }),
    ["user-2"],
  );
});

test("preferred sync dispatch returns no candidate when the preferred user has a running sync-family blocker", () => {
  assert.deepEqual(
    selectPendingCandidateUsersFromRows({
      types: [JobType.SYNC, JobType.NOTICE_SCAN],
      preferredUserId: "user-1",
      preferredHasEligiblePending: true,
      runningRows: [{ userId: "user-1", type: JobType.SYNC }],
      pendingRows: [{ userId: "user-1" }],
      limit: 1,
    }),
    [],
  );
});

test("autolearn dispatch only treats running autolearn jobs as blockers", () => {
  assert.deepEqual(getRunningBlockerTypesForDispatch([JobType.AUTOLEARN]), [JobType.AUTOLEARN]);
  assert.deepEqual(
    selectPendingCandidateUsersFromRows({
      types: [JobType.AUTOLEARN],
      preferredUserId: "user-1",
      preferredHasEligiblePending: true,
      runningRows: [{ userId: "user-1", type: JobType.SYNC }],
      pendingRows: [{ userId: "user-1" }],
      limit: 5,
    }),
    ["user-1"],
  );
  assert.deepEqual(
    selectPendingCandidateUsersFromRows({
      types: [JobType.AUTOLEARN],
      preferredUserId: "user-1",
      preferredHasEligiblePending: true,
      runningRows: [{ userId: "user-1", type: JobType.AUTOLEARN }],
      pendingRows: [{ userId: "user-1" }, { userId: "user-2" }],
      limit: 5,
    }),
    ["user-2"],
  );
});
