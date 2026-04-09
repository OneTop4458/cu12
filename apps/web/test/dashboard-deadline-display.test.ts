import assert from "node:assert/strict";
import test from "node:test";
import { formatDashboardDeadlineRemainingLabel } from "../src/lib/dashboard-deadline";

test("deadline display shows activity label for non-VOD zero-second tasks", () => {
  assert.equal(
    formatDashboardDeadlineRemainingLabel({
      activityType: "QUIZ",
      daysLeft: 2,
      remainingSeconds: 0,
    }),
    "D-2 / 퀴즈",
  );

  assert.equal(
    formatDashboardDeadlineRemainingLabel({
      activityType: "ASSIGNMENT",
      daysLeft: 0,
      remainingSeconds: 0,
    }),
    "오늘 마감 / 과제",
  );
});

test("deadline display keeps duration text for VOD and positive-second tasks", () => {
  assert.equal(
    formatDashboardDeadlineRemainingLabel({
      activityType: "VOD",
      daysLeft: 1,
      remainingSeconds: 90,
    }),
    "D-1 / 1분 30초",
  );

  assert.equal(
    formatDashboardDeadlineRemainingLabel({
      activityType: "MATERIAL",
      daysLeft: 3,
      remainingSeconds: 45,
    }),
    "D-3 / 45초",
  );
});
