import assert from "node:assert/strict";
import test from "node:test";
import type { LearningTask } from "@cu12/core";
import { mergeCyberCampusTaskWithDetail, planCyberCampusAutoLearnTasks } from "./cyber-campus-sync";

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
    taskTitle: "3장. 지구, 생명의 탄생",
    dueAt: "2026-04-12T23:59:00+09:00",
  });
  const detailTask = createTask({
    lectureSeq: 346814911,
    courseContentsSeq: 10,
    activityType: "VOD",
    weekNo: 5,
    lessonNo: 1,
    taskTitle: "1차시 3장. 지구, 생명의 탄생",
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
      taskTitle: "1차시 3장. 지구, 생명의 탄생",
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
    taskTitle: "핀테크와 가상자산_5주차 (시험시간 : 100분)",
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
        taskTitle: "토론형 퀴즈",
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
        taskTitle: "11차시",
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
