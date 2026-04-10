import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isMissingMailSubscriptionStoreError } from "../src/lib/mail-subscription-compat";

test("isMissingMailSubscriptionStoreError handles unknown Prisma request errors", () => {
  const error = new Prisma.PrismaClientUnknownRequestError(
    "The table `public.MailSubscription` does not exist.",
    { clientVersion: "6.19.3" },
  );

  assert.equal(isMissingMailSubscriptionStoreError(error), true);
});

test("isMissingMailSubscriptionStoreError handles known column errors", () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    "Column `digestHour` does not exist.",
    {
      code: "P2022",
      clientVersion: "6.19.3",
      meta: {
        column: "digestHour",
      },
    },
  );

  assert.equal(isMissingMailSubscriptionStoreError(error), true);
});

test("isMissingMailSubscriptionStoreError ignores unrelated Prisma errors", () => {
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

  assert.equal(isMissingMailSubscriptionStoreError(error), false);
});
