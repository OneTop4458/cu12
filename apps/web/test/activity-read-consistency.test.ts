import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { markAllActivityAsRead } from "../app/api/dashboard/activity/route";
import { prisma } from "../src/lib/prisma";

function swapMethod(
  t: TestContext,
  target: object,
  key: PropertyKey,
  replacement: (...args: never[]) => unknown,
) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, replacement);
  t.after(() => Reflect.set(target, key, original));
}

test("mark all reads more than the eight visible activity items across both providers", async (t) => {
  const calls: Array<{ kind: string; args: { where: Record<string, unknown> } }> = [];
  const stubUpdateMany = (target: object, key: string, kind: string) => {
    swapMethod(t, target, key, async (args: never) => {
      calls.push({ kind, args });
      return { count: 2 };
    });
  };

  stubUpdateMany(prisma.courseNotice, "updateMany", "notice");
  stubUpdateMany(prisma.notificationEvent, "updateMany", "notification");
  stubUpdateMany(prisma.portalMessage, "updateMany", "message");

  const updatedCount = await markAllActivityAsRead("user-read-all", new Date("2026-09-03T00:00:00.000Z"));

  assert.equal(updatedCount, 12);
  assert.equal(calls.length, 6);
  for (const provider of ["CU12", "CYBER_CAMPUS"]) {
    assert.deepEqual(calls.find((call) => call.kind === "notice" && call.args.where.provider === provider)?.args.where, {
      userId: "user-read-all",
      provider,
      isRead: false,
    });
    assert.deepEqual(calls.find((call) => call.kind === "notification" && call.args.where.provider === provider)?.args.where, {
      userId: "user-read-all",
      provider,
      isUnread: true,
    });
    assert.deepEqual(calls.find((call) => call.kind === "message" && call.args.where.provider === provider)?.args.where, {
      userId: "user-read-all",
      provider,
      isRead: false,
    });
  }
});

