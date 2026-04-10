import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isMissingSiteNoticeStoreError } from "../src/lib/site-notice-compat";

test("isMissingSiteNoticeStoreError handles unknown Prisma request errors", () => {
  const error = new Prisma.PrismaClientUnknownRequestError(
    "The table `public.SiteNotice` does not exist.",
    { clientVersion: "6.19.3" },
  );

  assert.equal(isMissingSiteNoticeStoreError(error), true);
});

test("isMissingSiteNoticeStoreError handles known column errors", () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    "Column `createdByUserId` does not exist.",
    {
      code: "P2022",
      clientVersion: "6.19.3",
      meta: {
        column: "createdByUserId",
      },
    },
  );

  assert.equal(isMissingSiteNoticeStoreError(error), true);
});

test("isMissingSiteNoticeStoreError handles displayTarget column errors", () => {
  const error = new Prisma.PrismaClientKnownRequestError(
    "Column `displayTarget` does not exist.",
    {
      code: "P2022",
      clientVersion: "6.19.3",
      meta: {
        column: "displayTarget",
      },
    },
  );

  assert.equal(isMissingSiteNoticeStoreError(error), true);
});

test("isMissingSiteNoticeStoreError ignores unrelated Prisma errors", () => {
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

  assert.equal(isMissingSiteNoticeStoreError(error), false);
});
