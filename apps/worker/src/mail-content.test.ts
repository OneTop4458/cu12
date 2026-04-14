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
    newMessages: [
      {
        title: "스터디 일정 안내",
        senderName: "학습지원팀",
        sentAt: "2026-04-07T09:30:00+09:00",
      },
    ],
    unreadMessageCount: 3,
    deadlineAlerts: [],
  });

  assert.ok(mail);
  assert.match(mail.html, /중간고사 안내/);
  assert.match(mail.html, /컴퓨터개론/);
  assert.match(mail.html, /자료구조/);
  assert.match(mail.html, /스터디 일정 안내/);
  assert.match(mail.html, /학습지원팀/);
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
    unreadMessageCount: 2,
    pendingTaskCount: 2,
    recentNotices: [],
    recentNotifications: [],
    recentMessages: [
      {
        title: "프로젝트 대상 공유",
        senderName: "교수님",
        sentAt: "2026-04-07T19:20:00+09:00",
        createdAt: "2026-04-07T19:21:00+09:00",
        isRead: false,
      },
    ],
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
  assert.match(mail.html, /프로젝트 대상 공유/);
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
    unreadMessageCount: 0,
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
    recentMessages: [],
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

test("autolearn result mail explains when a request stops at the cyber campus limit", () => {
  const mail = buildAutoLearnResultMail({
    dashboardBaseUrl: DASHBOARD_BASE_URL,
    generatedAt: new Date("2026-04-07T09:00:00+09:00"),
    mode: "ALL_COURSES",
    watchedTaskCount: 2,
    watchedSeconds: 3600,
    plannedTaskCount: 4,
    truncated: true,
    limitReached: true,
    remainingTaskCount: 2,
    estimatedTotalSeconds: 3600,
    planned: [],
    remainingPlanned: [
      {
        lectureSeq: 123,
        courseContentsSeq: 456,
        courseTitle: "Cyber Campus",
        weekNo: 6,
        lessonNo: 3,
        taskTitle: "Remaining lesson",
        state: "PENDING",
        activityType: "VOD",
        requiredSeconds: 1800,
        learnedSeconds: 0,
        availableFrom: "2026-04-07T09:00:00+09:00",
        dueAt: "2026-04-20T23:59:00+09:00",
        remainingSeconds: 1800,
      },
    ],
  });

  assert.match(mail.html, /1회 요청 최대 수강 한도/);
  assert.match(mail.html, /다시 요청/);
  assert.match(mail.html, /남은 차시/);
});
