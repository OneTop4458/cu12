import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutoLearnResultMail,
  buildDigestMail,
  buildSyncAlertMail,
} from "./mail-content";

const DASHBOARD_BASE_URL = "https://cu12.example.com";

test("sync alert hides low-confidence snippets but keeps meaningful headers", () => {
  const mail = buildSyncAlertMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-07T09:00:00+09:00"),
    newNotices: [
      {
        title: "중간고사 안내",
        author: "교수님",
        postedAt: "2026-04-01",
        bodyText: "등록일 2026.04.01 작성자 교수님 조회수 14",
        courseTitle: "컴퓨터개론",
      },
    ],
    newUnreadNotifications: [
      {
        courseTitle: "자료구조",
        category: "알림",
        message: "미확인 상세보기",
        occurredAt: "2026-04-07T09:10:00+09:00",
        isCanceled: false,
      },
    ],
    deadlineAlerts: [],
  });

  assert.ok(mail);
  assert.match(mail.html, /중간고사 안내/);
  assert.match(mail.html, /컴퓨터개론/);
  assert.match(mail.html, /자료구조/);
  assert.doesNotMatch(mail.html, /조회수 14/);
  assert.doesNotMatch(mail.html, /상세보기/);
});

test("digest omits empty notice and notification sections", () => {
  const mail = buildDigestMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-07T09:00:00+09:00"),
    activeCourseCount: 3,
    avgProgress: 72,
    unreadNoticeCount: 0,
    unreadNotificationCount: 0,
    pendingTaskCount: 2,
    recentNotices: [],
    recentNotifications: [],
    dueSoonTasks: [
      {
        lectureSeq: 501,
        courseTitle: "운영체제",
        weekNo: 4,
        lessonNo: 2,
        dueAt: "2026-04-09T23:59:00+09:00",
      },
    ],
  });

  assert.ok(mail);
  assert.match(mail.html, /임박 마감 차시/);
  assert.doesNotMatch(mail.html, /최근 공지/);
  assert.doesNotMatch(mail.html, /최근 알림/);
});

test("digest skips when no meaningful content remains after filtering", () => {
  const mail = buildDigestMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-07T09:00:00+09:00"),
    activeCourseCount: 1,
    avgProgress: 60,
    unreadNoticeCount: 0,
    unreadNotificationCount: 0,
    pendingTaskCount: 0,
    recentNotices: [],
    recentNotifications: [
      {
        courseTitle: "",
        category: "",
        message: "상세보기 미확인",
        occurredAt: null,
        createdAt: null,
        isUnread: true,
        isCanceled: false,
      },
    ],
    dueSoonTasks: [],
  });

  assert.equal(mail, null);
});

test("autolearn result mail omits empty notes and plan sections", () => {
  const mail = buildAutoLearnResultMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-07T09:00:00+09:00"),
    mode: "SINGLE_NEXT",
    watchedTaskCount: 1,
    watchedSeconds: 480,
    plannedTaskCount: 1,
    truncated: false,
    estimatedTotalSeconds: 480,
    planned: [],
  });

  assert.doesNotMatch(mail.html, /참고 사항/);
  assert.doesNotMatch(mail.html, /계획 차시/);
  assert.match(mail.html, /실행 요약/);
});
