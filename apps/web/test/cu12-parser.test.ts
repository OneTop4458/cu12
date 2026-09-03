import assert from "node:assert/strict";
import test from "node:test";
import { parseTodoTasks } from "@cu12/core";

test("CU12 todo parser treats the official attend marker as completed", () => {
  const html = `
    <ul class="class_list">
      <li>
        <a href="javascript:viewGo('C01', '101', '1', '1')">1주차 1차시</a>
        <span class="class_item_attend" aria-label=""></span>
      </li>
      <li>
        <a href="javascript:viewGo('C01', '102', '1', '2')">1주차 2차시</a>
        <span class="class_item_attend_offline" aria-label=""></span>
      </li>
      <li>
        <a href="javascript:viewGo('C01', '103', '1', '3')">1주차 3차시</a>
        <span class="contents_complete" aria-label=""></span>
      </li>
    </ul>
  `;

  const tasks = parseTodoTasks(html, "user-1", 9001);
  const stateByContentsSeq = new Map(tasks.map((task) => [task.courseContentsSeq, task.state]));

  assert.equal(stateByContentsSeq.get(101), "COMPLETED");
  assert.equal(stateByContentsSeq.get(102), "PENDING");
  assert.equal(stateByContentsSeq.get(103), "COMPLETED");
});
