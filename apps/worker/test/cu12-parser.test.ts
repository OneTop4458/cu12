import assert from "node:assert/strict";
import test from "node:test";

const { parseTodoTasks } = await import("@cu12/core");

test("parseTodoTasks maps live CU12 material and quiz links correctly", () => {
  const html = `
    <div class="todo_list">
      <a href="javascript:viewGo('C03', '26246', '6', '6','0');">글 [6.3] 6주차 수업교안 파일</a>
      <a href="javascript:viewGo('C02', '26247', '6', '6','0');">퀴즈 [6.4] 6주차 퀴즈 마감일 : 2026.04.13 23:59</a>
    </div>
  `;

  const tasks = parseTodoTasks(html, "user-1", 762);
  const material = tasks.find((task) => task.courseContentsSeq === 26246);
  const quiz = tasks.find((task) => task.courseContentsSeq === 26247);

  assert.ok(material);
  assert.equal(material?.activityType, "MATERIAL");
  assert.equal(material?.state, "PENDING");

  assert.ok(quiz);
  assert.equal(quiz?.activityType, "QUIZ");
  assert.equal(quiz?.state, "PENDING");
});

test("parseTodoTasks keeps completed material rows as completed", () => {
  const html = `
    <div class="contents_left_list active">
      <a href="javascript:viewGo('C03', '26246', '6', '6','0');">
        <div class="contents_left_list_title">6주차 수업교안</div>
        <span>글활동이 완료됨</span>
      </a>
    </div>
  `;

  const tasks = parseTodoTasks(html, "user-1", 762);
  assert.equal(tasks[0]?.activityType, "MATERIAL");
  assert.equal(tasks[0]?.state, "COMPLETED");
});
