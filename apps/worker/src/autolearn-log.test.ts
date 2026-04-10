import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAutoLearnFailureLog,
  formatAutoLearnStartLog,
  formatAutoLearnSummaryLog,
} from "./autolearn-log";

test("formatAutoLearnStartLog includes provider, mode, lecture, and segment", () => {
  const line = formatAutoLearnStartLog({
    jobId: "job-1",
    provider: "CYBER_CAMPUS",
    mode: "SINGLE_ALL",
    lectureSeq: 377289926,
    chainSegment: 2,
  });

  assert.match(line, /\[AUTOLEARN\] start/);
  assert.match(line, /provider=CYBER_CAMPUS/);
  assert.match(line, /mode=SINGLE_ALL/);
  assert.match(line, /targetLecture=377289926/);
  assert.match(line, /segment=2/);
});

test("formatAutoLearnSummaryLog exposes no-op context for log triage", () => {
  const line = formatAutoLearnSummaryLog({
    jobId: "job-2",
    provider: "CYBER_CAMPUS",
    mode: "SINGLE_NEXT",
    lectureSeq: 346814911,
    plannedTaskCount: 0,
    processedTaskCount: 0,
    noOpReason: "NO_AVAILABLE_VOD_TASKS",
    lectureSeqs: [],
  });

  assert.match(line, /\[AUTOLEARN\] summary/);
  assert.match(line, /planned=0/);
  assert.match(line, /processed=0/);
  assert.match(line, /noOp=NO_AVAILABLE_VOD_TASKS/);
  assert.match(line, /resultLectures=-/);
});

test("formatAutoLearnFailureLog serializes errors safely", () => {
  const line = formatAutoLearnFailureLog({
    jobId: "job-3",
    provider: "CU12",
    mode: "ALL_COURSES",
    error: "AUTOLEARN_STALLED",
    stalled: true,
  });

  assert.match(line, /\[AUTOLEARN\] failed/);
  assert.match(line, /provider=CU12/);
  assert.match(line, /targetLecture=ALL/);
  assert.match(line, /stalled=true/);
  assert.match(line, /"AUTOLEARN_STALLED"/);
});
