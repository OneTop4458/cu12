import assert from "node:assert/strict";
import test from "node:test";
import { parseCyberCampusMainCoursesHtml, parseCyberCampusTodoListHtml } from "@cu12/core";

test("Cyber Campus course parser clamps oversized lecture ids into signed int32 range", () => {
  const rawLectureId = "4552251044";
  const html = `
    <html>
      <body>
        <em class="sub_open" kj="${rawLectureId}">Distributed Systems</em>
      </body>
    </html>
  `;

  const courses = parseCyberCampusMainCoursesHtml(html, "user-1");
  assert.equal(courses.length, 1);
  assert.equal(courses[0].externalLectureId, rawLectureId);
  assert.equal(Number.isInteger(courses[0].lectureSeq), true);
  assert.equal(courses[0].lectureSeq > 0, true);
  assert.equal(courses[0].lectureSeq <= 2147483647, true);
});

test("Cyber Campus todo parser reuses the same signed int32-safe lectureSeq for oversized ids", () => {
  const rawLectureId = "4552251044";
  const html = `
    <html>
      <body>
        <div class="todo_wrap" onclick="goLecture('${rawLectureId}','321','lecture_weeks')">
          <div class="todo_title">1주차 1차시 온라인강의</div>
          <div class="todo_date"><span class="todo_date">2026.04.10 PM 11:59</span></div>
        </div>
      </body>
    </html>
  `;

  const tasks = parseCyberCampusTodoListHtml(html, "user-1");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].externalLectureId, rawLectureId);
  assert.equal(tasks[0].lectureSeq > 0, true);
  assert.equal(tasks[0].lectureSeq <= 2147483647, true);
});
