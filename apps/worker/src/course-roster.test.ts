import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCourseRoster,
  extractCu12CourseRosterIdentifiers,
  extractCyberCampusCourseRosterIdentifiers,
} from "./course-roster";

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
