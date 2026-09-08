import assert from "node:assert/strict";
import test from "node:test";
import {
  describeDashboardCourseState,
  formatDashboardAccountStatus,
  formatDashboardApprovalRuntimeState,
  formatDashboardApprovalStatus,
  formatDashboardJobStatus,
  formatDashboardSyncQueueState,
} from "../src/lib/dashboard-presentation";

const syncedSummary = { activeCourseCount: 0, initialSyncRequired: false, lastSyncAt: "2026-09-08T01:00:00Z" };
const emptyInput = { courseCount: 0, loading: false, failedProviders: [], summary: syncedSummary };

test("all job states have readable labels and blocked work is distinct from failure", () => {
  assert.deepEqual(
    ["PENDING", "BLOCKED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"].map(formatDashboardJobStatus),
    ["실행 대기", "진행 보류", "실행 중", "완료", "실패", "취소됨"],
  );
});

test("queue labels distinguish waiting and running delays without calling idle synchronized", () => {
  assert.deepEqual(
    ["IDLE", "PENDING", "PENDING_STALE", "RUNNING", "RUNNING_STALE"].map(formatDashboardSyncQueueState),
    ["대기 작업 없음", "동기화 대기 중", "동기화 대기 지연", "동기화 중", "동기화 진행 지연"],
  );
});

test("approval and account states use Korean labels throughout the authentication flow", () => {
  assert.deepEqual(
    ["PENDING", "ACTIVE", "COMPLETED", "EXPIRED", "CANCELED"].map(formatDashboardApprovalStatus),
    ["인증 대기", "인증 진행 중", "인증 완료", "인증 만료", "인증 취소됨"],
  );
  for (const state of ["BOOTSTRAPPING", "WAITING_METHOD", "STARTING_METHOD", "WAITING_CODE", "CONFIRMING", "VERIFIED", "RESUMING_AUTOLEARN", "COMPLETED", "FAILED"]) {
    assert.match(formatDashboardApprovalRuntimeState(state), /[가-힣]/);
    assert.notEqual(formatDashboardApprovalRuntimeState(state), "상태 확인 필요");
  }
  assert.equal(formatDashboardApprovalRuntimeState("WAITING_CODE"), "인증번호 입력 대기");
  assert.equal(formatDashboardApprovalRuntimeState("RESUMING_AUTOLEARN"), "자동 수강 재개 중");
  assert.deepEqual(
    ["CONNECTED", "NEEDS_REAUTH", "ERROR"].map(formatDashboardAccountStatus),
    ["연결됨", "다시 로그인 필요", "연결 오류"],
  );
});

test("missing and unknown states never expose raw codes or inherited object properties", () => {
  for (const format of [formatDashboardJobStatus, formatDashboardSyncQueueState, formatDashboardApprovalStatus, formatDashboardApprovalRuntimeState, formatDashboardAccountStatus]) {
    for (const status of [undefined, null, ""]) assert.equal(format(status), "상태 정보 없음");
    for (const status of ["FUTURE_STATUS", "toString", "__proto__"]) assert.equal(format(status), "상태 확인 필요");
  }
});

test("initial and retry loading cannot present successful empty data or a stale failure", () => {
  for (const failedProviders of [[], ["CU12" as const]]) {
    const state = describeDashboardCourseState({ ...emptyInput, loading: true, failedProviders, summary: null });
    assert.equal(state?.kind, "loading");
    assert.equal(state?.action, null);
    assert.match(state?.message ?? "", /불러오는 중/);
  }
});

test("a successful empty collection after a known sync gives an empty-state explanation", () => {
  const state = describeDashboardCourseState(emptyInput);
  assert.equal(state?.kind, "empty");
  assert.equal(state?.action, "sync");
  assert.match(state?.message ?? "", /현재 표시할 강좌 정보가 없습니다/);
});

test("initial sync is suggested only when the summary explicitly requires it and has no sync history", () => {
  const state = describeDashboardCourseState({
    ...emptyInput, summary: { ...syncedSummary, initialSyncRequired: true, lastSyncAt: null },
  });
  assert.equal(state?.kind, "initial-sync");
  assert.equal(state?.action, "sync");
  assert.equal(describeDashboardCourseState({ ...emptyInput, summary: { ...syncedSummary, lastSyncAt: null } })?.kind, "empty");
  assert.equal(describeDashboardCourseState({ ...emptyInput, summary: { ...syncedSummary, initialSyncRequired: true } })?.kind, "empty");
});

test("absent summary and contradictory course counts cannot claim a successful empty collection", () => {
  for (const summary of [null, { ...syncedSummary, activeCourseCount: 2 }]) {
    const state = describeDashboardCourseState({ ...emptyInput, summary });
    assert.equal(state?.kind, "unavailable");
    assert.equal(state?.action, "refresh");
  }
});

test("partial provider failure stays visible even when the other provider returns no courses", () => {
  const state = describeDashboardCourseState({ ...emptyInput, failedProviders: ["CYBER_CAMPUS"] });
  assert.equal(state?.kind, "error");
  assert.equal(state?.action, "refresh");
  assert.match(state?.message ?? "", /사이버캠퍼스 강좌 정보를 불러오지 못했습니다/);
  assert.doesNotMatch(state?.message ?? "", /공유대/);
});

test("total collection failure overrides a never-synced summary and names both providers", () => {
  const state = describeDashboardCourseState({
    ...emptyInput, failedProviders: ["CU12", "CYBER_CAMPUS"],
    summary: { ...syncedSummary, initialSyncRequired: true, lastSyncAt: null },
  });
  assert.equal(state?.kind, "error");
  assert.match(state?.message ?? "", /공유대, 사이버캠퍼스/);
});

test("failed refresh warns about retained courses, then clears after a successful retry", () => {
  const input = { ...emptyInput, courseCount: 3 };
  const failed = describeDashboardCourseState({ ...input, failedProviders: ["CU12"] });
  assert.equal(failed?.kind, "error");
  assert.match(failed?.message ?? "", /표시된 정보가 최신이 아닐 수 있습니다/);
  assert.equal(describeDashboardCourseState(input), null);
  assert.equal(describeDashboardCourseState({ ...input, loading: true }), null);
});
