import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNoticeListHtml,
  parseNotificationListHtml,
  scoreNoticeBodyQuality,
  selectPreferredNoticeBody,
  shouldResolveNoticeDetailBody,
} from "@cu12/core";

test("parseNoticeListHtml ignores metadata-heavy inline bodies", () => {
  const html = `
    <ul>
      <li class="notice_item">
        <button id="notice_tit_101" class="notice_title">\uC911\uAC04\uACE0\uC0AC \uC548\uB0B4</button>
        <div class="notice_body">\uB4F1\uB85D\uC77C 2026.04.01 \uC791\uC131\uC790 \uAD50\uC218\uB2D8 \uC870\uD68C\uC218 14</div>
      </li>
    </ul>
  `;

  const notices = parseNoticeListHtml(html, "user-1", 101);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.bodyText, "");
  assert.equal(shouldResolveNoticeDetailBody(notices[0]?.bodyText), true);
});

test("navigation-heavy boilerplate is treated as low-confidence notice body", () => {
  const boilerplate =
    "\uC2E0\uACBD\uC2EC\uB9AC\uD559 \uBCF8\uBB38\uC73C\uB85C \uC774\uB3D9 "
    + "\uAC15\uC758\uC2E4\uBA54\uB274\uB85C \uC774\uB3D9 "
    + "\uAC00\uD1A8\uB9AD\uACF5\uC720\uB300\uD559 \uBA54\uC778\uD654\uBA74 "
    + "\uB098\uC758\uACFC\uC815 \uC218\uAC15\uC2E0\uCCAD\uB0B4\uC5ED \uC218\uAC15\uC2DC\uAC04\uD45C "
    + "\uACF5\uACB0\uC2E0\uCCAD \uC774\uC218\uC99D \uCD9C\uB825 \uD504\uB85C\uD544 \uC124\uC815 \uB85C\uADF8\uC544\uC6C3";

  assert.ok(scoreNoticeBodyQuality(boilerplate) < 0);
  assert.equal(shouldResolveNoticeDetailBody(boilerplate), true);
});

test("notice detail body replaces a low-confidence list body", () => {
  const listBody =
    "\uC2E0\uACBD\uC2EC\uB9AC\uD559 \uBCF8\uBB38\uC73C\uB85C \uC774\uB3D9 "
    + "\uAC15\uC758\uC2E4\uBA54\uB274\uB85C \uC774\uB3D9 "
    + "\uAC00\uD1A8\uB9AD\uACF5\uC720\uB300\uD559 \uBA54\uC778\uD654\uBA74 "
    + "\uB098\uC758\uACFC\uC815 \uC218\uAC15\uC2E0\uCCAD\uB0B4\uC5ED";
  const detailBody =
    "\uC548\uB155\uD558\uC138\uC694? \uC2E0\uACBD\uC2EC\uB9AC \uC190\uC7AC\uD658 \uAD50\uC218\uC785\uB2C8\uB2E4. "
    + "\uAE30\uB9D0\uC2DC\uD5D8(6\uC6D4 11\uC77C \uBAA9 21:00)\uC5D0 \uAD00\uD574 \uBB38\uC758 \uC8FC\uC2E0 \uBD84\uC774 \uB9CE\uC544 \uACF5\uC9C0\uD569\uB2C8\uB2E4.";

  assert.equal(shouldResolveNoticeDetailBody(listBody), true);
  assert.equal(selectPreferredNoticeBody(listBody, detailBody), detailBody);
});

test("parseNotificationListHtml removes unread badges, timestamps, and repeated subjects", () => {
  const html = `
    <ul>
      <li class="notification_item" data-notifier-seq="501">
        <span class="notification_subject">\uCEF4\uD4E8\uD130\uAC1C\uB860</span>
        <span class="notification_text">[\uACF5\uC9C0] \uCEF4\uD4E8\uD130\uAC1C\uB860 \uC911\uAC04\uACE0\uC0AC \uC77C\uC815\uC774 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uBBF8\uD655\uC778</span>
        <span class="notification_day">2026.04.07 \uC624\uD6C4 1:20</span>
        <button>\uC0C1\uC138\uBCF4\uAE30</button>
      </li>
    </ul>
  `;

  const notifications = parseNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.courseTitle, "\uCEF4\uD4E8\uD130\uAC1C\uB860");
  assert.equal(notifications[0]?.category, "\uACF5\uC9C0");
  assert.equal(notifications[0]?.message, "\uC911\uAC04\uACE0\uC0AC \uC77C\uC815\uC774 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
  assert.equal(notifications[0]?.isUnread, true);
});

test("canceled notifications do not preserve noisy action-only text", () => {
  const html = `
    <ul>
      <li class="notification_item" data-notifier-seq="777">
        <span class="notification_subject">\uC790\uB8CC\uAD6C\uC870</span>
        <span class="notification_text">\uC790\uB8CC\uAD6C\uC870 \uB9C8\uAC10 \uBBF8\uD655\uC778 \uC0C1\uC138\uBCF4\uAE30</span>
        <span class="notification_day">2026.04.07 \uC624\uC804 9:00</span>
      </li>
    </ul>
  `;

  const notifications = parseNotificationListHtml(html, "user-1");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.isCanceled, true);
  assert.equal(notifications[0]?.message, "");
});
