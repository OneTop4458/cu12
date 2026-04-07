import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNoticeListHtml,
  parseNotificationListHtml,
  selectPreferredNoticeBody,
  shouldResolveNoticeDetailBody,
} from "@cu12/core";

test("parseNoticeListHtml ignores metadata-heavy inline bodies", () => {
  const html = `
    <ul>
      <li class="notice_item">
        <button id="notice_tit_101" class="notice_title">중간고사 안내</button>
        <div class="notice_body">등록일 2026.04.01 작성자 교수님 조회수 14</div>
      </li>
    </ul>
  `;

  const notices = parseNoticeListHtml(html, "user-1", 101);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.bodyText, "");
  assert.equal(shouldResolveNoticeDetailBody(notices[0]?.bodyText), true);
});

test("notice detail body replaces a low-confidence list body", () => {
  const listBody = "등록일 2026.04.01 작성자 교수님 조회수 14";
  const detailBody = "중간고사 범위와 시험 시간을 안내드립니다.";

  assert.equal(shouldResolveNoticeDetailBody(listBody), true);
  assert.equal(selectPreferredNoticeBody(listBody, detailBody), detailBody);
});

test("parseNotificationListHtml removes unread badges, timestamps, and repeated subjects", () => {
  const html = `
    <ul>
      <li class="notification_item" data-notifier-seq="501">
        <span class="notification_subject">컴퓨터개론</span>
        <span class="notification_text">[공지] 컴퓨터개론 중간고사 일정이 변경되었습니다. 미확인</span>
        <span class="notification_day">2026.04.07 오후 1:20</span>
        <button>상세보기</button>
      </li>
    </ul>
  `;

  const notifications = parseNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.courseTitle, "컴퓨터개론");
  assert.equal(notifications[0]?.category, "공지");
  assert.equal(notifications[0]?.message, "중간고사 일정이 변경되었습니다.");
  assert.equal(notifications[0]?.isUnread, true);
});

test("canceled notifications do not preserve noisy action-only text", () => {
  const html = `
    <ul>
      <li class="notification_item" data-notifier-seq="777">
        <span class="notification_subject">자료구조</span>
        <span class="notification_text">자료구조 마감 미확인 상세보기</span>
        <span class="notification_day">2026.04.07 오전 9:00</span>
      </li>
    </ul>
  `;

  const notifications = parseNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.isCanceled, true);
  assert.equal(notifications[0]?.message, "");
});
