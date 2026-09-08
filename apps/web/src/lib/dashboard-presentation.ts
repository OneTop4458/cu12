type DashboardProvider = "CU12" | "CYBER_CAMPUS";

function formatStatus(status: string | null | undefined, labels: Record<string, string>): string {
  if (!status) return "상태 정보 없음";
  return Object.prototype.hasOwnProperty.call(labels, status) ? labels[status] : "상태 확인 필요";
}

export function formatDashboardJobStatus(status: string | null | undefined): string {
  return formatStatus(status, {
    PENDING: "실행 대기",
    BLOCKED: "진행 보류",
    RUNNING: "실행 중",
    SUCCEEDED: "완료",
    FAILED: "실패",
    CANCELED: "취소됨",
  });
}

export function formatDashboardSyncQueueState(state: string | null | undefined): string {
  return formatStatus(state, {
    IDLE: "대기 작업 없음",
    PENDING: "동기화 대기 중",
    PENDING_STALE: "동기화 대기 지연",
    RUNNING: "동기화 중",
    RUNNING_STALE: "동기화 진행 지연",
  });
}

export function formatDashboardApprovalStatus(status: string | null | undefined): string {
  return formatStatus(status, {
    PENDING: "인증 대기",
    ACTIVE: "인증 진행 중",
    COMPLETED: "인증 완료",
    EXPIRED: "인증 만료",
    CANCELED: "인증 취소됨",
  });
}

export function formatDashboardApprovalRuntimeState(state: string | null | undefined): string {
  return formatStatus(state, {
    BOOTSTRAPPING: "인증 준비 중",
    WAITING_METHOD: "인증 방식 선택 대기",
    STARTING_METHOD: "인증 요청 중",
    WAITING_CODE: "인증번호 입력 대기",
    CONFIRMING: "인증 확인 중",
    VERIFIED: "인증 확인 완료",
    RESUMING_AUTOLEARN: "자동 수강 재개 중",
    COMPLETED: "처리 완료",
    FAILED: "인증 처리 실패",
  });
}

export function formatDashboardAccountStatus(status: string | null | undefined): string {
  return formatStatus(status, {
    CONNECTED: "연결됨",
    NEEDS_REAUTH: "다시 로그인 필요",
    ERROR: "연결 오류",
  });
}

export interface DashboardCourseState {
  kind: "loading" | "error" | "initial-sync" | "empty" | "unavailable";
  message: string;
  action: "sync" | "refresh" | null;
}

export function describeDashboardCourseState(input: {
  courseCount: number;
  loading: boolean;
  failedProviders: readonly DashboardProvider[];
  summary: { lastSyncAt: string | null; initialSyncRequired: boolean; activeCourseCount: number } | null;
}): DashboardCourseState | null {
  if (input.loading && input.courseCount === 0) {
    return { kind: "loading", message: "강좌 정보를 불러오는 중입니다.", action: null };
  }
  if (input.failedProviders.length > 0) {
    const providers = input.failedProviders.map((provider) => provider === "CU12" ? "공유대" : "사이버캠퍼스");
    return {
      kind: "error",
      message: `${providers.join(", ")} 강좌 정보를 불러오지 못했습니다.${input.courseCount > 0 ? " 표시된 정보가 최신이 아닐 수 있습니다." : ""} 다시 불러와 주세요.`,
      action: "refresh",
    };
  }
  if (input.courseCount > 0) return null;
  if (!input.summary) {
    return { kind: "unavailable", message: "강좌 상태를 확인하지 못했습니다. 화면을 새로고침해 주세요.", action: "refresh" };
  }
  if (input.summary.activeCourseCount > 0) {
    return { kind: "unavailable", message: "강좌 목록과 요약 정보가 일치하지 않습니다. 화면을 다시 불러와 주세요.", action: "refresh" };
  }
  if (input.summary.initialSyncRequired && !input.summary.lastSyncAt) {
    return {
      kind: "initial-sync",
      message: "아직 동기화 이력이 없습니다. 위의 학습 데이터 동기화에서 강좌 정보를 가져와 주세요.",
      action: "sync",
    };
  }
  return {
    kind: "empty",
    message: "현재 표시할 강좌 정보가 없습니다. 수강 중인 강좌가 있다면 학습 데이터를 동기화해 주세요.",
    action: "sync",
  };
}
