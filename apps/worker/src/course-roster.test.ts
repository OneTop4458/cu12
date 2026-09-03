import assert from "node:assert/strict";
import test from "node:test";
import { parseMyCourseHtml, type CourseState, type LearningTask } from "@cu12/core";
import {
  assessCourseRoster,
  extractCu12CourseRosterIdentifiers,
  extractCyberCampusCourseRosterIdentifiers,
  filterPriorTermCu12Courses,
} from "./course-roster";

function makeCourse(lectureSeq: number, periodEnd: string | null): CourseState {
  return {
    userId: "test-user",
    provider: "CU12",
    lectureSeq,
    title: `Course ${lectureSeq}`,
    instructor: null,
    progressPercent: 0,
    remainDays: null,
    recentLearnedAt: null,
    periodStart: null,
    periodEnd,
    status: "ACTIVE",
    syncedAt: "2026-09-03T00:00:00.000Z",
  };
}

function makeTask(lectureSeq: number, dueAt: string | null): LearningTask {
  return {
    userId: "test-user",
    provider: "CU12",
    lectureSeq,
    courseContentsSeq: lectureSeq,
    weekNo: 1,
    lessonNo: 1,
    activityType: "VOD",
    requiredSeconds: 60,
    learnedSeconds: 0,
    state: "PENDING",
    dueAt,
  };
}

test("course roster accepts a complete CU12 roster", () => {
  const html = `
    <main>
      <a href="javascript:enterClass(101)">Course A</a>
      <a href="javascript:enterClass(202)">Course B</a>
    </main>
  `;

  assert.deepEqual(assessCourseRoster({
    html,
    currentUrl: "https://example.test/el/member/mycourse_list_form.acl",
    expectedPath: "/el/member/mycourse_list_form.acl",
    sourceIdentifiers: extractCu12CourseRosterIdentifiers(html),
    parsedIdentifiers: ["101", "202"],
  }), {
    authoritative: true,
    reason: "AUTHORITATIVE_ENTRIES",
  });
});

test("course roster accepts the async CU12 fragment and ignores ended course links", () => {
  const html = `
    <div id="list_zone" class="course_list_wrap">
      <div class="course_list_v2">
        <a class="link_946" href="javascript:enterClass(946)">Current Course</a>
        <a class="link_946" href="javascript:enterClass(946);">Current Course Room</a>
      </div>
      <div class="course_list_v2">
        <a href="/el/course/course_info_form.acl?COURSE_SEQ=422&LECTURE_SEQ=834">Ended Course</a>
      </div>
    </div>
  `;

  const sourceIdentifiers = extractCu12CourseRosterIdentifiers(html);
  const parsedIdentifiers = parseMyCourseHtml(html, "test-user").map((course) => String(course.lectureSeq));
  assert.deepEqual(sourceIdentifiers, ["946", "946"]);
  assert.deepEqual(parsedIdentifiers, ["946"]);
  assert.deepEqual(assessCourseRoster({
    html,
    currentUrl: "https://example.test/el/member/mycourse_list.acl",
    expectedPath: "/el/member/mycourse_list.acl",
    sourceIdentifiers,
    parsedIdentifiers,
  }), {
    authoritative: true,
    reason: "AUTHORITATIVE_ENTRIES",
  });
});

test("course roster accepts an explicit normal empty roster", () => {
  const html = "<main><p>현재 수강 중인 강좌가 없습니다.</p></main>";

  assert.equal(assessCourseRoster({
    html,
    currentUrl: "https://example.test/el/member/mycourse_list_form.acl",
    expectedPath: "/el/member/mycourse_list_form.acl",
    sourceIdentifiers: [],
    parsedIdentifiers: [],
  }).authoritative, true);
});

test("course roster rejects authentication, missing markers, and partial parsing", () => {
  const shared = {
    currentUrl: "https://example.test/el/member/mycourse_list_form.acl",
    expectedPath: "/el/member/mycourse_list_form.acl",
  };

  assert.equal(assessCourseRoster({
    ...shared,
    html: "<form action='/login'><input type='password'></form>",
    sourceIdentifiers: [],
    parsedIdentifiers: [],
  }).authoritative, false);
  assert.equal(assessCourseRoster({
    ...shared,
    html: "<main>Unexpected response</main>",
    sourceIdentifiers: [],
    parsedIdentifiers: [],
  }).authoritative, false);
  assert.deepEqual(assessCourseRoster({
    ...shared,
    html: "<main></main>",
    sourceIdentifiers: ["101", "202"],
    parsedIdentifiers: ["101"],
  }), {
    authoritative: false,
    reason: "PARTIAL_PARSE",
  });
});

test("Cyber Campus roster source identifiers are deduplicated by assessment", () => {
  const html = `
    <main>
      <em class="sub_open" kj="A20262001">Course A</em>
      <em class="sub_open" onclick="eclassRoom('A20262001')">Course A duplicate</em>
    </main>
  `;

  assert.equal(assessCourseRoster({
    html,
    currentUrl: "https://example.test/ilos/main/main_form.acl",
    expectedPath: "/ilos/main/main_form.acl",
    sourceIdentifiers: extractCyberCampusCourseRosterIdentifiers(html),
    parsedIdentifiers: ["A20262001"],
  }).authoritative, true);
});

test("CU12 roster excludes courses whose dated activity belongs to a prior academic term", () => {
  const courses = [
    makeCourse(101, "2025-08-18"),
    makeCourse(202, null),
    makeCourse(303, "2026-12-09"),
    makeCourse(404, null),
    makeCourse(505, null),
  ];
  const tasks = [
    makeTask(202, "2025-10-20T16:00:00+09:00"),
    makeTask(404, "2026-08-17T00:00:00+09:00"),
  ];

  const filtered = filterPriorTermCu12Courses(
    courses,
    tasks,
    new Date("2026-09-03T09:00:00+09:00"),
  );

  assert.deepEqual(filtered.map((course) => course.lectureSeq), [303, 404, 505]);
});

test("CU12 second-semester window remains current through the following January", () => {
  const courses = [makeCourse(101, null), makeCourse(202, null)];
  const tasks = [
    makeTask(101, "2026-06-30T23:59:00+09:00"),
    makeTask(202, "2026-12-20T23:59:00+09:00"),
  ];

  const filtered = filterPriorTermCu12Courses(
    courses,
    tasks,
    new Date("2027-01-15T09:00:00+09:00"),
  );

  assert.deepEqual(filtered.map((course) => course.lectureSeq), [202]);
});
