import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAutoNoOpForDashboard,
  formatAutoLimitReachedMessage,
  formatAutoNoOpReason,
  parseAutoLearnNoOpReason,
} from "../src/lib/autolearn-noop";

test("parseAutoLearnNoOpReason accepts Cyber Campus VOD-specific reasons", () => {
  assert.equal(parseAutoLearnNoOpReason("NO_PENDING_VOD_TASKS"), "NO_PENDING_VOD_TASKS");
  assert.equal(parseAutoLearnNoOpReason("NO_AVAILABLE_VOD_TASKS"), "NO_AVAILABLE_VOD_TASKS");
});

test("describeAutoNoOpForDashboard explains quiz-only Cyber Campus lectures", () => {
  const message = describeAutoNoOpForDashboard({
    provider: "CYBER_CAMPUS",
    mode: "SINGLE_ALL",
    reason: "NO_PENDING_VOD_TASKS",
    course: {
      lectureSeq: 377289926,
      title: "IT조직행동론",
      pendingTaskTypeCounts: {
        VOD: 0,
        MATERIAL: 0,
        QUIZ: 3,
        ASSIGNMENT: 0,
        ETC: 0,
      },
    },
  });

  assert.equal(message, "이 강의는 자동 수강할 영상은 없고 퀴즈 3개만 남아 있습니다.");
});

test("describeAutoNoOpForDashboard explains future-only Cyber Campus lectures", () => {
  const message = describeAutoNoOpForDashboard({
    provider: "CYBER_CAMPUS",
    mode: "SINGLE_NEXT",
    reason: "NO_AVAILABLE_VOD_TASKS",
    course: {
      lectureSeq: 373653502,
      title: "핀테크와가상자산",
      pendingTaskTypeCounts: {
        VOD: 3,
        MATERIAL: 0,
        QUIZ: 1,
        ASSIGNMENT: 0,
        ETC: 0,
      },
    },
  });

  assert.equal(message, "이 강의는 미완료 영상 3개가 남아 있지만 아직 학습 가능 기간이 아니거나 이미 마감되었습니다.");
});

test("formatAutoNoOpReason keeps generic CU12 messaging", () => {
  assert.equal(formatAutoNoOpReason("NO_PENDING_SUPPORTED_TASKS"), "자동 처리 가능한 강의/자료/퀴즈가 없습니다.");
});

test("formatAutoLimitReachedMessage explains that a new request is required", () => {
  assert.match(formatAutoLimitReachedMessage(2), /2/);
  assert.match(formatAutoLimitReachedMessage(2), /다시 요청/);
});
