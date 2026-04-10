import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isMissingWorkerHeartbeatStoreError } from "../src/lib/worker-heartbeat-compat";

test("isMissingWorkerHeartbeatStoreError handles unknown Prisma request errors", () => {
  const error = new Prisma.PrismaClientUnknownRequestError(
    "The table `public.WorkerHeartbeat` does not exist.",
    { clientVersion: "6.19.3" },
  );

  assert.equal(isMissingWorkerHeartbeatStoreError(error), true);
});

test("isMissingWorkerHeartbeatStoreError handles known column errors", () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    "Column `lastSeenAt` does not exist.",
    {
      code: "P2022",
      clientVersion: "6.19.3",
      meta: {
        column: "lastSeenAt",
      },
    },
  );

  assert.equal(isMissingWorkerHeartbeatStoreError(error), true);
});

test("isMissingWorkerHeartbeatStoreError ignores unrelated Prisma errors", () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    "Column `withdrawnAt` does not exist.",
    {
      code: "P2022",
      clientVersion: "6.19.3",
      meta: {
        column: "withdrawnAt",
      },
    },
  );

  assert.equal(isMissingWorkerHeartbeatStoreError(error), false);
});
