import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { CourseState } from "@cu12/core";
import { prisma } from "./prisma";
import { persistSnapshot } from "./sync-store";

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

function makeCourse(lectureSeq: number): CourseState {
  return {
    userId: "user-1",
    provider: "CU12",
    lectureSeq,
    externalLectureId: null,
    title: `Course ${lectureSeq}`,
    instructor: null,
    progressPercent: 0,
    remainDays: null,
    recentLearnedAt: null,
    periodStart: null,
    periodEnd: null,
    status: "ACTIVE",
    syncedAt: "2026-09-02T00:00:00.000Z",
  };
}

function makeNotice(noticeKey: string, syncedAt: string) {
  return {
    userId: "user-1",
    provider: "CU12" as const,
    lectureSeq: 101,
    noticeKey,
    title: "시험 일정 안내",
    author: "교수자",
    postedAt: "2026-09-02",
    bodyText: "중간고사 일정은 강의실에서 확인하세요.",
    isNew: true,
    syncedAt,
  };
}

function emptySnapshot(courseRosterAuthoritative: boolean, courses: CourseState[] = []) {
  return {
    courseRosterAuthoritative,
    courses,
    notices: [],
    notifications: [],
    tasks: [],
  };
}

function installPersistenceStubs(t: TestContext) {
  const upserts: unknown[] = [];
  const updates: unknown[] = [];

  swapMethod(t, prisma.courseSnapshot, "upsert", async (args: never) => {
    upserts.push(args);
    return {};
  });
  swapMethod(t, prisma.courseSnapshot, "updateMany", async (args: never) => {
    updates.push(args);
    return { count: 1 };
  });
  swapMethod(t, prisma.courseNotice, "findMany", async () => []);
  swapMethod(t, prisma.portalMessage, "count", async () => 0);

  return { upserts, updates };
}

test("authoritative roster retires missing ACTIVE courses and keeps current courses ACTIVE", async (t) => {
  const calls = installPersistenceStubs(t);

  const result = await persistSnapshot("user-1", "CU12", emptySnapshot(true, [makeCourse(202), makeCourse(303)]));

  assert.equal(result.endedCourseCount, 1);
  assert.equal(calls.upserts.length, 2);
  assert.deepEqual((calls.upserts[0] as { update: { status: string } }).update.status, "ACTIVE");
  assert.deepEqual((calls.upserts[0] as { create: { status: string } }).create.status, "ACTIVE");
  assert.deepEqual(calls.updates, [{
    where: {
      userId: "user-1",
      provider: "CU12",
      status: "ACTIVE",
      lectureSeq: { notIn: [202, 303] },
    },
    data: { status: "ENDED" },
  }]);
});

test("read notices stay read when a reparse changes the notice key", async (t) => {
  const oldRow = {
    id: "notice-old",
    lectureSeq: 101,
    noticeKey: "legacy-key",
    title: "시험 일정 안내",
    author: "교수자",
    postedAt: new Date("2026-09-02T00:00:00.000Z"),
    bodyText: "중간고사 일정은 강의실에서 확인하세요.",
    isRead: true,
    isNew: false,
    syncedAt: new Date("2026-09-02T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
  };
  const reparsedRow = { ...oldRow, id: "notice-reparsed", noticeKey: "new-key", isRead: false };
  let noticeFindManyCalls = 0;
  const noticeUpserts: unknown[] = [];
  const noticeUpdates: unknown[] = [];

  swapMethod(t, prisma.courseSnapshot, "upsert", async () => ({}));
  swapMethod(t, prisma.courseSnapshot, "updateMany", async () => ({ count: 0 }));
  swapMethod(t, prisma.courseNotice, "findMany", async () => {
    noticeFindManyCalls += 1;
    return (noticeFindManyCalls === 1 ? [oldRow] : [oldRow, reparsedRow]) as never;
  });
  swapMethod(t, prisma.courseNotice, "upsert", async (args: never) => {
    noticeUpserts.push(args);
    return {};
  });
  swapMethod(t, prisma.courseNotice, "update", async (args: never) => {
    noticeUpdates.push(args);
    return {};
  });
  swapMethod(t, prisma.courseNotice, "deleteMany", async () => ({ count: 1 }));
  swapMethod(t, prisma.portalMessage, "count", async () => 0);

  const result = await persistSnapshot("user-1", "CU12", {
    courseRosterAuthoritative: true,
    courses: [makeCourse(101)],
    notices: [makeNotice("new-key", "2026-09-03T00:00:00.000Z")],
    notifications: [],
    tasks: [],
  });

  assert.equal(result.newNoticeCount, 0);
  assert.equal((noticeUpserts[0] as { create: { isRead: boolean } }).create.isRead, true);
  assert.equal((noticeUpdates[0] as { data: { isRead: boolean } }).data.isRead, true);
});

test("unverified or partial roster never retires an existing course", async (t) => {
  const calls = installPersistenceStubs(t);

  const result = await persistSnapshot("user-1", "CU12", emptySnapshot(false, [makeCourse(202)]));

  assert.equal(result.endedCourseCount, 0);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.updates.length, 0);
});

test("authoritative empty roster retires all ACTIVE courses only in its user/provider scope", async (t) => {
  const calls = installPersistenceStubs(t);

  const result = await persistSnapshot("user-empty", "CYBER_CAMPUS", emptySnapshot(true));

  assert.equal(result.endedCourseCount, 1);
  assert.deepEqual(calls.updates, [{
    where: {
      userId: "user-empty",
      provider: "CYBER_CAMPUS",
      status: "ACTIVE",
    },
    data: { status: "ENDED" },
  }]);
});
