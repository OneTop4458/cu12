import assert from "node:assert/strict";
import test from "node:test";
import { JobType } from "@prisma/client";
import {
  getRunningBlockerTypesForDispatch,
  selectPendingCandidateUsersFromRows,
} from "../src/server/github-actions-dispatch";

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
