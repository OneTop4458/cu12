export type AutoLearnNoOpReason =
  | "NO_ACTIVE_COURSES"
  | "LECTURE_NOT_FOUND"
  | "NO_PENDING_TASKS"
  | "NO_PENDING_VOD_TASKS"
  | "NO_AVAILABLE_VOD_TASKS"
  | "NO_PENDING_SUPPORTED_TASKS"
  | "NO_AVAILABLE_SUPPORTED_TASKS"
  | "NO_TASKS_AFTER_FILTER";

export interface ActivityTypeCountsLike {
  VOD: number;
  MATERIAL: number;
  QUIZ: number;
  ASSIGNMENT: number;
  ETC: number;
}

export interface AutoLearnCourseLike {
  lectureSeq: number;
  title: string;
  pendingTaskTypeCounts: ActivityTypeCountsLike | null;
}

type PortalProvider = "CU12" | "CYBER_CAMPUS";
type AutoLearnMode = "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";

const AUTOLEARN_NOOP_REASONS = new Set<AutoLearnNoOpReason>([
  "NO_ACTIVE_COURSES",
  "LECTURE_NOT_FOUND",
  "NO_PENDING_TASKS",
  "NO_PENDING_VOD_TASKS",
  "NO_AVAILABLE_VOD_TASKS",
  "NO_PENDING_SUPPORTED_TASKS",
  "NO_AVAILABLE_SUPPORTED_TASKS",
  "NO_TASKS_AFTER_FILTER",
]);

export function parseAutoLearnNoOpReason(value: unknown): AutoLearnNoOpReason | null {
  if (typeof value !== "string" || !AUTOLEARN_NOOP_REASONS.has(value as AutoLearnNoOpReason)) {
    return null;
  }
  return value as AutoLearnNoOpReason;
}

export function formatAutoNoOpReason(reason: AutoLearnNoOpReason | null | undefined): string {
  if (!reason) return "현재 자동 수강 가능한 차시가 없습니다.";
  if (reason === "NO_ACTIVE_COURSES") return "진행 중인 과목이 없습니다.";
  if (reason === "LECTURE_NOT_FOUND") return "요청한 강의가 진행 대상이 아니거나 비활성 상태입니다.";
  if (reason === "NO_PENDING_TASKS") return "현재 진행 대상 차시가 없습니다.";
  if (reason === "NO_PENDING_VOD_TASKS") return "미완료 영상 차시가 없습니다.";
  if (reason === "NO_AVAILABLE_VOD_TASKS") return "남아 있는 영상 차시가 아직 학습 가능 기간이 아니거나 이미 마감되었습니다.";
  if (reason === "NO_PENDING_SUPPORTED_TASKS") return "자동 처리 가능한 강의/자료/퀴즈가 없습니다.";
  if (reason === "NO_AVAILABLE_SUPPORTED_TASKS") return "학습 가능 기간에 있는 강의/자료/퀴즈가 없습니다.";
  return "자동 수강 대상이 없습니다.";
}

function formatPendingNonVodCounts(counts: ActivityTypeCountsLike): string | null {
  const labels: string[] = [];
  if (counts.QUIZ > 0) labels.push(`퀴즈 ${counts.QUIZ}개`);
  if (counts.MATERIAL > 0) labels.push(`자료 ${counts.MATERIAL}개`);
  if (counts.ASSIGNMENT > 0) labels.push(`과제 ${counts.ASSIGNMENT}개`);
  if (counts.ETC > 0) labels.push(`기타 ${counts.ETC}개`);
  return labels.length > 0 ? labels.join(" / ") : null;
}

export function describeAutoNoOpForDashboard(input: {
  provider: PortalProvider;
  mode: AutoLearnMode | null;
  reason: AutoLearnNoOpReason | null | undefined;
  course?: AutoLearnCourseLike | null;
}): string {
  const generic = formatAutoNoOpReason(input.reason);
  if (
    input.provider !== "CYBER_CAMPUS"
    || input.mode === null
    || input.mode === "ALL_COURSES"
    || !input.course
    || !input.reason
  ) {
    return generic;
  }

  const counts = input.course.pendingTaskTypeCounts;
  if (!counts) return generic;

  if (input.reason === "NO_PENDING_VOD_TASKS" || input.reason === "NO_PENDING_SUPPORTED_TASKS") {
    if (counts.VOD > 0) return generic;
    const nonVodSummary = formatPendingNonVodCounts(counts);
    if (nonVodSummary) {
      return `이 강의는 자동 수강할 영상은 없고 ${nonVodSummary}만 남아 있습니다.`;
    }
    return `이 강의에는 자동 수강할 미완료 영상이 없습니다.`;
  }

  if (input.reason === "NO_AVAILABLE_VOD_TASKS" || input.reason === "NO_AVAILABLE_SUPPORTED_TASKS") {
    if (counts.VOD > 0) {
      return `이 강의는 미완료 영상 ${counts.VOD}개가 남아 있지만 아직 학습 가능 기간이 아니거나 이미 마감되었습니다.`;
    }
  }

  return generic;
}
