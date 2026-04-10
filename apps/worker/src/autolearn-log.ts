import type { PortalProvider } from "@cu12/core";
import type { AutoLearnMode, AutoLearnNoOpReason } from "./cu12-automation";

interface AutoLearnLogBase {
  jobId: string;
  provider: PortalProvider;
  mode: AutoLearnMode;
  lectureSeq?: number | null;
  chainSegment?: number;
}

interface AutoLearnSummaryLogInput extends AutoLearnLogBase {
  plannedTaskCount: number;
  processedTaskCount: number;
  noOpReason?: AutoLearnNoOpReason | null;
  lectureSeqs?: number[];
}

interface AutoLearnFailureLogInput extends AutoLearnLogBase {
  error: string;
  stalled?: boolean;
}

function formatTargetLecture(lectureSeq?: number | null): string {
  return typeof lectureSeq === "number" && Number.isFinite(lectureSeq)
    ? String(lectureSeq)
    : "ALL";
}

function formatResultLectures(lectureSeqs?: number[]): string {
  if (!lectureSeqs || lectureSeqs.length === 0) return "-";
  return Array.from(new Set(lectureSeqs)).sort((a, b) => a - b).join(",");
}

function createBaseParts(input: AutoLearnLogBase): string[] {
  const parts = [
    `job=${input.jobId}`,
    `provider=${input.provider}`,
    `mode=${input.mode}`,
    `targetLecture=${formatTargetLecture(input.lectureSeq)}`,
  ];
  if (typeof input.chainSegment === "number" && Number.isFinite(input.chainSegment)) {
    parts.push(`segment=${Math.max(1, Math.floor(input.chainSegment))}`);
  }
  return parts;
}

export function formatAutoLearnStartLog(input: AutoLearnLogBase): string {
  return `[AUTOLEARN] start ${createBaseParts(input).join(" ")}`;
}

export function formatAutoLearnSummaryLog(input: AutoLearnSummaryLogInput): string {
  const parts = createBaseParts(input);
  parts.push(`planned=${input.plannedTaskCount}`);
  parts.push(`processed=${input.processedTaskCount}`);
  parts.push(`noOp=${input.noOpReason ?? "-"}`);
  parts.push(`resultLectures=${formatResultLectures(input.lectureSeqs)}`);
  return `[AUTOLEARN] summary ${parts.join(" ")}`;
}

export function formatAutoLearnFailureLog(input: AutoLearnFailureLogInput): string {
  const parts = createBaseParts(input);
  parts.push(`stalled=${input.stalled === true ? "true" : "false"}`);
  parts.push(`error=${JSON.stringify(input.error)}`);
  return `[AUTOLEARN] failed ${parts.join(" ")}`;
}
