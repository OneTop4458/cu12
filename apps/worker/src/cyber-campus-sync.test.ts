import assert from "node:assert/strict";
import test from "node:test";
import type { LearningTask } from "@cu12/core";
import {
  classifyCyberCampusDialogMessage,
  extractCyberCampusLaunchParamsFromHtml,
  getCyberCampusPlaybackWaitSeconds,
  mergeCyberCampusTaskWithDetail,
  planCyberCampusAutoLearnTasks,
  selectCyberCampusChunkTasks,
  shouldUseLegacyCyberCampusLaunchFallback,
} from "./cyber-campus-sync";

function createTask(input: Partial<LearningTask> & Pick<LearningTask, "lectureSeq" | "courseContentsSeq" | "activityType">): LearningTask {
  return {
    userId: input.userId ?? "user-1",
    lectureSeq: input.lectureSeq,
    externalLectureId: input.externalLectureId ?? "A202610632871",
    courseContentsSeq: input.courseContentsSeq,
    weekNo: input.weekNo ?? 0,
    lessonNo: input.lessonNo ?? 0,
    taskTitle: input.taskTitle ?? "",
    activityType: input.activityType,
    requiredSeconds: input.requiredSeconds ?? 0,
    learnedSeconds: input.learnedSeconds ?? 0,
    state: input.state ?? "PENDING",
    availableFrom: input.availableFrom ?? null,
    dueAt: input.dueAt ?? null,
  };
}

test("worker-side Cyber Campus task merge prefers authoritative detail fields", () => {
  const baseTask = createTask({
    lectureSeq: 346814911,
    courseContentsSeq: 10,
    activityType: "VOD",
    weekNo: 3,
    lessonNo: 10,
    taskTitle: "base task",
    dueAt: "2026-04-12T23:59:00+09:00",
  });
  const detailTask = createTask({
    lectureSeq: 346814911,
    courseContentsSeq: 10,
    activityType: "VOD",
    weekNo: 5,
    lessonNo: 1,
    taskTitle: "detail task",
    requiredSeconds: 3480,
    learnedSeconds: 750,
    availableFrom: "2026-04-03T00:00:00+09:00",
    dueAt: "2026-04-12T23:59:00+09:00",
  });

  const merged = mergeCyberCampusTaskWithDetail(baseTask, detailTask);
  assert.deepEqual(
    {
      weekNo: merged.weekNo,
      lessonNo: merged.lessonNo,
      taskTitle: merged.taskTitle,
      requiredSeconds: merged.requiredSeconds,
      learnedSeconds: merged.learnedSeconds,
      availableFrom: merged.availableFrom,
      dueAt: merged.dueAt,
    },
    {
      weekNo: 5,
      lessonNo: 1,
      taskTitle: "detail task",
      requiredSeconds: 3480,
      learnedSeconds: 750,
      availableFrom: "2026-04-03T00:00:00+09:00",
      dueAt: "2026-04-12T23:59:00+09:00",
    },
  );
});

test("worker-side Cyber Campus task merge falls back to lightweight task when detail is unavailable", () => {
  const baseTask = createTask({
    lectureSeq: 373653502,
    courseContentsSeq: 4,
    activityType: "QUIZ",
    weekNo: 5,
    lessonNo: 4,
    taskTitle: "quiz task",
    dueAt: "2026-04-04T12:00:00+09:00",
  });

  const merged = mergeCyberCampusTaskWithDetail(baseTask, null);
  assert.deepEqual(merged, baseTask);
});

test("planCyberCampusAutoLearnTasks reports quiz-only lectures as no pending VOD", () => {
  const plan = planCyberCampusAutoLearnTasks(
    [
      createTask({
        lectureSeq: 377289926,
        courseContentsSeq: 3,
        activityType: "QUIZ",
        taskTitle: "quiz only",
      }),
    ],
    {
      mode: "SINGLE_ALL",
      lectureSeq: 377289926,
      nowMs: Date.parse("2026-04-10T11:00:00+09:00"),
    },
  );

  assert.equal(plan.planned.length, 0);
  assert.equal(plan.scopedPendingVodCount, 0);
  assert.equal(plan.noOpReason, "NO_PENDING_VOD_TASKS");
});

test("planCyberCampusAutoLearnTasks reports future-only lectures as no available VOD", () => {
  const plan = planCyberCampusAutoLearnTasks(
    [
      createTask({
        lectureSeq: 373653502,
        courseContentsSeq: 11,
        activityType: "VOD",
        taskTitle: "lesson 11",
        availableFrom: "2026-04-11T12:00:00+09:00",
        dueAt: "2026-04-20T23:59:00+09:00",
      }),
    ],
    {
      mode: "SINGLE_ALL",
      lectureSeq: 373653502,
      nowMs: Date.parse("2026-04-10T11:00:00+09:00"),
    },
  );

  assert.equal(plan.planned.length, 0);
  assert.equal(plan.scopedPendingVodCount, 1);
  assert.equal(plan.scopedAvailableVodCount, 0);
  assert.equal(plan.noOpReason, "NO_AVAILABLE_VOD_TASKS");
});

test("selectCyberCampusChunkTasks stops before an overflow lesson and leaves it for a later request", () => {
  const plan = planCyberCampusAutoLearnTasks(
    [
      createTask({
        lectureSeq: 373653502,
        courseContentsSeq: 11,
        activityType: "VOD",
        taskTitle: "lesson 11",
        requiredSeconds: 1200,
      }),
      createTask({
        lectureSeq: 373653502,
        courseContentsSeq: 12,
        activityType: "VOD",
        taskTitle: "lesson 12",
        requiredSeconds: 3000,
      }),
      createTask({
        lectureSeq: 373653502,
        courseContentsSeq: 13,
        activityType: "VOD",
        taskTitle: "lesson 13",
        requiredSeconds: 1800,
      }),
    ],
    {
      mode: "SINGLE_ALL",
      lectureSeq: 373653502,
      nowMs: Date.parse("2026-04-10T11:00:00+09:00"),
    },
  );

  const chunk = selectCyberCampusChunkTasks(plan.planned, {
    AUTOLEARN_MAX_TASKS: 50,
    AUTOLEARN_CHUNK_TARGET_SECONDS: 3600,
    AUTOLEARN_TIME_FACTOR: 1,
  });

  assert.equal(chunk.planned.length, 1);
  assert.equal(chunk.planned[0]?.courseContentsSeq, 11);
  assert.equal(chunk.estimatedTotalSeconds, 1200);
  assert.equal(chunk.remainingTaskCount, 2);
  assert.equal(chunk.remainingPlanned[0]?.courseContentsSeq, 12);
  assert.equal(chunk.truncated, true);
});

test("selectCyberCampusChunkTasks allows the first long lesson even when it exceeds the request limit", () => {
  const plan = planCyberCampusAutoLearnTasks(
    [
      createTask({
        lectureSeq: 377289926,
        courseContentsSeq: 21,
        activityType: "VOD",
        taskTitle: "long lesson",
        requiredSeconds: 10800,
      }),
    ],
    {
      mode: "SINGLE_ALL",
      lectureSeq: 377289926,
      nowMs: Date.parse("2026-04-10T11:00:00+09:00"),
    },
  );

  const chunk = selectCyberCampusChunkTasks(plan.planned, {
    AUTOLEARN_MAX_TASKS: 50,
    AUTOLEARN_CHUNK_TARGET_SECONDS: 3600,
    AUTOLEARN_TIME_FACTOR: 1,
  });

  assert.equal(chunk.planned.length, 1);
  assert.equal(chunk.planned[0]?.courseContentsSeq, 21);
  assert.equal(chunk.estimatedTotalSeconds, 10800);
  assert.equal(chunk.remainingTaskCount, 0);
  assert.equal(chunk.truncated, false);
});

test("extractCyberCampusLaunchParamsFromHtml reads the real viewGo argument order", () => {
  const launchParams = extractCyberCampusLaunchParamsFromHtml(
    "<a href=\"javascript:viewGo('6','2085121','20260419235959','20260410121300','OCW12345');\">Start</a>",
  );

  assert.deepEqual(launchParams, {
    week: "6",
    lectureWeeksSeq: "2085121",
    endDateKey: "20260419235959",
    currentDateKey: "20260410121300",
    itemId: "OCW12345",
  });
});

test("classifyCyberCampusDialogMessage detects duplicate-playback and learning-window warnings", () => {
  assert.equal(
    classifyCyberCampusDialogMessage("\uB2E4\uB978 \uAE30\uAE30\uB098 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uAC15\uC758\uB97C \uC2DC\uCCAD \uC911\uC785\uB2C8\uB2E4."),
    "DUPLICATE_PLAYBACK",
  );
  assert.equal(
    classifyCyberCampusDialogMessage("\uCD9C\uC11D\uC778\uC815\uAE30\uAC04\uC774 \uC9C0\uB098 \uCD9C\uC11D\uC2DC\uAC04\uC73C\uB85C \uC778\uC815\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."),
    "LEARNING_WINDOW_WARNING",
  );
});

test("getCyberCampusPlaybackWaitSeconds never shortens playback below real time", () => {
  assert.equal(getCyberCampusPlaybackWaitSeconds(1800, 0.25), 1800);
  assert.equal(getCyberCampusPlaybackWaitSeconds(1800, 1), 1800);
  assert.equal(getCyberCampusPlaybackWaitSeconds(1800, 1.1), 1981);
});

test("shouldUseLegacyCyberCampusLaunchFallback prefers legacy launch for weekNo 0 and missing launch params", () => {
  assert.equal(
    shouldUseLegacyCyberCampusLaunchFallback({ weekNo: 0 }, new Error("CYBER_CAMPUS_TASK_LAUNCH_PARAMS_MISSING:10")),
    true,
  );
  assert.equal(
    shouldUseLegacyCyberCampusLaunchFallback({ weekNo: 6 }, new Error("CYBER_CAMPUS_TASK_ROW_NOT_FOUND:10")),
    true,
  );
  assert.equal(
    shouldUseLegacyCyberCampusLaunchFallback({ weekNo: 6 }, new Error("SOME_OTHER_ERROR")),
    false,
  );
});
