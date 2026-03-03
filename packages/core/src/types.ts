export type CourseStatus = "ACTIVE" | "UPCOMING" | "ENDED";

export interface CourseState {
  userId: string;
  lectureSeq: number;
  title: string;
  instructor: string | null;
  progressPercent: number;
  remainDays: number | null;
  recentLearnedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: CourseStatus;
  syncedAt: string;
}

export interface CourseNotice {
  userId: string;
  lectureSeq: number;
  noticeKey: string;
  noticeSeq?: string;
  title: string;
  author: string | null;
  postedAt: string | null;
  bodyText: string;
  isNew: boolean;
  syncedAt: string;
}

export interface NotificationEvent {
  userId: string;
  notifierSeq: string;
  courseTitle: string;
  category: string;
  message: string;
  occurredAt: string | null;
  isCanceled: boolean;
  isUnread: boolean;
  syncedAt: string;
}

export interface LearningTask {
  userId: string;
  lectureSeq: number;
  courseContentsSeq: number;
  weekNo: number;
  lessonNo: number;
  activityType: "VOD" | "QUIZ" | "ASSIGNMENT" | "ETC";
  requiredSeconds: number;
  learnedSeconds: number;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  availableFrom?: string | null;
  dueAt?: string | null;
}

export type QueueJobType = "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
export type QueueJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface QueuePayload {
  userId: string;
  lectureSeq?: number;
  autoLearnMode?: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";
  courseContentsSeq?: number;
  reason?: string;
}

export interface Cu12Credentials {
  cu12Id: string;
  cu12Password: string;
  campus: "SONGSIM" | "SONGSIN";
}

