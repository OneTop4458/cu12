import assert from "node:assert/strict";
import test from "node:test";
import type { LearningTask } from "@cu12/core";
import { mergeCyberCampusTaskWithDetail } from "./cyber-campus-sync";

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
