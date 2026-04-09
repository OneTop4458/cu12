import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isMissingWithdrawnAtColumnError, withWithdrawnAtFallback } from "../src/lib/withdrawn-compat";

test("isMissingWithdrawnAtColumnError handles unknown Prisma request errors", () => {
  const error = new Prisma.PrismaClientUnknownRequestError(
    "Unknown column `withdrawnAt` in field list",
    { clientVersion: "test" },
  );

  assert.equal(isMissingWithdrawnAtColumnError(error), true);
});

test("isMissingWithdrawnAtColumnError handles generic driver errors", () => {
  const error = new Error("column \"withdrawnAt\" does not exist");

  assert.equal(isMissingWithdrawnAtColumnError(error), true);
});

test("withWithdrawnAtFallback retries with the legacy query for unknown Prisma request errors", async () => {
  const result = await withWithdrawnAtFallback<{ id: string; email: string; withdrawnAt: Date | null }>(
    async () => {
      throw new Prisma.PrismaClientUnknownRequestError(
        "Unknown column `withdrawnAt` in field list",
        { clientVersion: "test" },
      );
    },
    async () => ({
      id: "user_1",
      email: "user@example.com",
    }),
  );

  assert.deepEqual(result, {
    id: "user_1",
    email: "user@example.com",
    withdrawnAt: null,
  });
});
