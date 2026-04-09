import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCyberCampusCommunityNoticeDetailHtml,
  parseCyberCampusCourseSubmainHtml,
  parseCyberCampusExamDetailHtml,
  parseCyberCampusMainCoursesHtml,
  parseCyberCampusNotificationListHtml,
  parseCyberCampusOnlineWeekDetailHtml,
  parseCyberCampusTodoListHtml,
} from "@cu12/core";

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
          <div class="todo_title">[\uC628\uB77C\uC778\uAC15\uC758] 1\uC8FC\uCC28 1\uCC28\uC2DC</div>
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

test("Cyber Campus online week detail parser extracts authoritative week, lesson, window, duration, and progress", () => {
  const html = `
    <html>
      <body>
        <div id="week-2" class="ibox3 wb wb-on">2\uC8FC 3/3</div>
        <div id="week-3" class="ibox3 wb wb-on">3\uC8FC 3/3</div>
        <div id="week-4" class="ibox3 wb wb-on">4\uC8FC 3/3</div>
        <div id="week-5" class="ibox3 wb wb-on wb-choice">5\uC8FC 0/3</div>

        <div id="lecture-10" class="lecture-box">
          <ul>
            <li>1\uCC28\uC2DC 3\uC7A5. \uC9C0\uAD6C, \uC0DD\uBA85\uC758 \uD0C4\uC0DD</li>
            <li>\uCD9C\uC11D\uC778\uC815\uAE30\uAC04 : 2026.04.03 \uC624\uC804 12:00 ~ 2026.04.12 \uC624\uD6C4 11:59</li>
            <li>\uD559\uC2B5\uB0B4\uC5ED : \uAE30\uAC04\uB0B4 \uD559\uC2B5\uC2DC\uAC04 / \uCD9C\uC11D\uC778\uC815\uC2DC\uAC04</li>
            <li>0:00 / 58:00</li>
          </ul>
          <span class="site-mouseover-color" onclick="viewGo('5', '10', '202604122359', '202604091027', '2PTS3AM565LSM');">
            \uCC28\uC2DC \uC5F4\uAE30
          </span>
        </div>

        <div id="lecture-11" class="lecture-box">
          <ul>
            <li>2\uCC28\uC2DC 3\uC7A5. \uC9C0\uAD6C, \uC0DD\uBA85\uC758 \uD0C4\uC0DD</li>
            <li>\uCD9C\uC11D\uC778\uC815\uAE30\uAC04 : 2026.04.03 \uC624\uC804 12:00 ~ 2026.04.12 \uC624\uD6C4 11:59</li>
            <li>\uD559\uC2B5\uB0B4\uC5ED : \uAE30\uAC04\uB0B4 \uD559\uC2B5\uC2DC\uAC04 / \uCD9C\uC11D\uC778\uC815\uC2DC\uAC04</li>
            <li>12:30 / 58:00</li>
          </ul>
          <span class="site-mouseover-color" onclick="viewGo('5', '11', '202604122359', '202604091027', '');">
            \uCC28\uC2DC \uC5F4\uAE30
          </span>
        </div>
      </body>
    </html>
  `;

  const detail = parseCyberCampusOnlineWeekDetailHtml(html, "user-1", "A202610632871");
  assert.equal(detail.progressPercent, 75);
  assert.equal(detail.tasks.length, 2);
  assert.deepEqual(
    detail.tasks.map((task) => ({
      courseContentsSeq: task.courseContentsSeq,
      weekNo: task.weekNo,
      lessonNo: task.lessonNo,
      availableFrom: task.availableFrom,
      dueAt: task.dueAt,
      requiredSeconds: task.requiredSeconds,
      learnedSeconds: task.learnedSeconds,
    })),
    [
      {
        courseContentsSeq: 10,
        weekNo: 5,
        lessonNo: 1,
        availableFrom: "2026-04-03T00:00:00+09:00",
        dueAt: "2026-04-12T23:59:00+09:00",
        requiredSeconds: 3480,
        learnedSeconds: 0,
      },
      {
        courseContentsSeq: 11,
        weekNo: 5,
        lessonNo: 2,
        availableFrom: "2026-04-03T00:00:00+09:00",
        dueAt: "2026-04-12T23:59:00+09:00",
        requiredSeconds: 3480,
        learnedSeconds: 750,
      },
    ],
  );
});

test("Cyber Campus submain parser discovers all online weeks and quiz refs", () => {
  const html = `
    <html>
      <body>
        <table class="week_list">
          <tr>
            <td week_no="1">1</td>
            <td week_no="2">2</td>
            <td week_no="3">3</td>
            <td week_no="4">4</td>
            <td week_no="5">5</td>
            <td week_no="6">6</td>
          </tr>
        </table>

        <div id="week_list_wrap_1" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/lecture_material_view_form.acl?ARTL_NUM=5532926'">
            <span class="week-div">강의자료</span>
            <span class="week-title">강의자료__0306</span>
          </div>
        </div>

        <div id="week_list_wrap_2" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=2'">
            <span class="week-div">2주 1차시 온라인 강의</span>
            <span class="wb-status">100%</span>
            <span class="week-title">2026.03.10 오전 12:00 ~ 2026.03.27 오후 10:00</span>
          </div>
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=2'">
            <span class="week-div">2주 2차시 온라인 강의</span>
            <span class="wb-status">100%</span>
            <span class="week-title">2026.03.10 오전 12:00 ~ 2026.03.27 오후 10:00</span>
          </div>
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=2'">
            <span class="week-div">2주 3차시 온라인 강의</span>
            <span class="wb-status">100%</span>
            <span class="week-title">2026.03.10 오전 12:00 ~ 2026.03.27 오후 10:00</span>
          </div>
          <div class="week-list" onclick="location.href='/ilos/st/course/test_view_form.acl?exam_setup_seq=1&SCH_KEY=&SCH_VALUE='">
            <span class="week-div">시험</span>
            <span class="week-title">과학기술시대의 삶_0313</span>
          </div>
        </div>

        <div id="week_list_wrap_3" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=3'">
            <span class="week-div">3주 1차시 온라인 강의</span>
            <span class="wb-status">100%</span>
            <span class="week-title">2026.03.20 오전 12:00 ~ 2026.03.29 오후 11:59</span>
          </div>
        </div>

        <div id="week_list_wrap_4" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=4'">
            <span class="week-div">4주 1차시 온라인 강의</span>
            <span class="wb-status">100%</span>
            <span class="week-title">2026.03.27 오전 12:00 ~ 2026.04.05 오후 11:59</span>
          </div>
        </div>

        <div id="week_list_wrap_5" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=5'">
            <span class="week-div">5주 1차시 온라인 강의</span>
            <span class="wb-status">0%</span>
            <span class="week-title">2026.04.03 오전 12:00 ~ 2026.04.12 오후 11:59</span>
          </div>
        </div>

        <div id="week_list_wrap_6" class="submain-week">
          <div class="week-list" onclick="location.href='/ilos/st/course/online_list_form.acl?WEEK_NO=6'">
            <span class="week-div">6주 1차시 온라인 강의</span>
            <span class="wb-status">0%</span>
            <span class="week-title">2026.04.10 오전 12:00 ~ 2026.04.19 오후 11:59</span>
          </div>
        </div>
      </body>
    </html>
  `;

  const parsed = parseCyberCampusCourseSubmainHtml(html);
  assert.equal(parsed.progressPercent, 71);
  assert.deepEqual(parsed.onlineWeekNumbers, [2, 3, 4, 5, 6]);
  assert.deepEqual(parsed.quizRefs, [
    {
      weekNo: 2,
      examSetupSeq: 1,
      href: "/ilos/st/course/test_view_form.acl?exam_setup_seq=1&SCH_KEY=&SCH_VALUE=",
      title: "과학기술시대의 삶_0313",
    },
  ]);
});

test("Cyber Campus exam detail parser extracts authoritative quiz timing", () => {
  const html = `
    <html>
      <body>
        <table class="bbsview">
          <tr><th>\uC8FC\uCC28</th><td>5 \uC8FC (2026.03.31 ~ 2026.04.06)</td></tr>
          <tr><th>\uC81C\uBAA9</th><td>\uD540\uD14C\uD06C\uC640 \uAC00\uC0C1\uC790\uC0B0_5\uC8FC\uCC28</td></tr>
          <tr><th>\uC2DC\uC791\uC2DC\uAC04</th><td>2026.04.04 \uC624\uD6C4 12:00</td></tr>
          <tr><th>\uC885\uB8CC\uC2DC\uAC04</th><td>2026.04.17 \uC624\uD6C4 11:59</td></tr>
          <tr><th>\uC2DC\uD5D8\uC2DC\uAC04</th><td>100 \uBD84</td></tr>
        </table>
      </body>
    </html>
  `;

  const task = parseCyberCampusExamDetailHtml(html, "user-1", "A202610714501", 4);
  assert.ok(task);
  assert.equal(task?.weekNo, 5);
  assert.equal(task?.taskTitle, "\uD540\uD14C\uD06C\uC640 \uAC00\uC0C1\uC790\uC0B0_5\uC8FC\uCC28");
  assert.equal(task?.availableFrom, "2026-04-04T12:00:00+09:00");
  assert.equal(task?.dueAt, "2026-04-17T23:59:00+09:00");
  assert.equal(task?.requiredSeconds, 6000);
  assert.equal(task?.activityType, "QUIZ");
});

test("Cyber Campus notification parser does not treat deadline text as cancellation", () => {
  const html = `
    <html>
      <body>
        <div class="notification_title">2026.04.07 \uD654\uC694\uC77C</div>
        <div class="notification_content" onclick="goSubjectPage('A202610752701','2493036','S');">
          <div class="notification_subject">IT\uC870\uC9C1\uD589\uB3D9\uB860(01)</div>
          <div class="notification_text"><span>[\uC628\uB77C\uC778\uAC15\uC758]</span> 6\uC8FC 3\uCC28\uC2DC \uC628\uB77C\uC778 \uAC15\uC758\uB97C \uC2DC\uC791\uD569\uB2C8\uB2E4. (\uD559\uC2B5\uB9C8\uAC10: 2026.04.13 \uC624\uD6C4 11:59 \uAE4C\uC9C0)</div>
          <div class="notification_day"><span>2\uC77C \uC804 \uC624\uC804 12:00</span></div>
        </div>
      </body>
    </html>
  `;

  const notifications = parseCyberCampusNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.isCanceled, false);
});

test("Cyber Campus notification parser only flags actual cancellation semantics", () => {
  const html = `
    <html>
      <body>
        <div class="notification_title">2026.04.08 \uC218\uC694\uC77C</div>
        <div class="notification_content" onclick="goSubjectPage('A202610752701','2510000','S');">
          <div class="notification_subject">IT\uC870\uC9C1\uD589\uB3D9\uB860(01)</div>
          <div class="notification_text"><span>[\uC2DC\uD5D8]</span> \uC911\uAC04\uACE0\uC0AC\uAC00 \uCDE8\uC18C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.</div>
          <div class="notification_day"><span>\uC624\uD6C4 1:20</span></div>
        </div>
      </body>
    </html>
  `;

  const notifications = parseCyberCampusNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.isCanceled, true);
});

test("Cyber Campus community notice detail parser returns non-empty body text", () => {
  const html = `
    <html>
      <body>
        <div class="artl_title_form">
          <div class="artl_reg_info">\uC791\uC131\uC790: \uD559\uC0AC\uC9C0\uC6D0\uD300 \uB4F1\uB85D\uC77C: 2026.03.03</div>
        </div>
        <div class="artl_content_form">
          <div class="textviewer">
            \uBCF8\uAD50 \uC131\uC2EC\uAD50\uC815 \uD559\uBD80\uACFC\uC815\uC5D0\uC11C\uB294 \uCCAD\uAC15\uC81C\uB3C4\uB97C \uC6B4\uC601\uD558\uACE0 \uC788\uC9C0 \uC54A\uC544
            \uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB0B4 \uCCAD\uAC15 \uAE30\uB2A5 \uC0AC\uC6A9\uC744 \uAE08\uC9C0\uD569\uB2C8\uB2E4.
          </div>
        </div>
      </body>
    </html>
  `;

  const detail = parseCyberCampusCommunityNoticeDetailHtml(html);
  assert.equal(detail.author, "\uD559\uC0AC\uC9C0\uC6D0\uD300");
  assert.equal(detail.postedAt, "2026-03-03");
  assert.match(detail.bodyText, /\uCCAD\uAC15/);
});
