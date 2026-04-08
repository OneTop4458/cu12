export type PortalProvider = "CU12" | "CYBER_CAMPUS";
export type PortalCampus = "SONGSIM" | "SONGSIN";

export type CourseStatus = "ACTIVE" | "UPCOMING" | "ENDED";

export interface CourseState {
  userId: string;
  provider?: PortalProvider;
  lectureSeq: number;
  externalLectureId?: string | null;
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
  provider?: PortalProvider;
  lectureSeq: number;
  externalLectureId?: string | null;
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
  provider?: PortalProvider;
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
  provider?: PortalProvider;
  lectureSeq: number;
  externalLectureId?: string | null;
  courseContentsSeq: number;
  weekNo: number;
  lessonNo: number;
  taskTitle?: string;
  activityType: "VOD" | "MATERIAL" | "QUIZ" | "ASSIGNMENT" | "ETC";
  requiredSeconds: number;
  learnedSeconds: number;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  availableFrom?: string | null;
  dueAt?: string | null;
}

export interface PortalMessage {
  userId: string;
  provider?: PortalProvider;
  messageSeq: string;
  title: string;
  senderId?: string | null;
  senderName?: string | null;
  bodyText: string;
  sentAt?: string | null;
  isRead: boolean;
  syncedAt: string;
}

export type QueueJobType = "SYNC" | "AUTOLEARN" | "NOTICE_SCAN" | "MAIL_DIGEST";
export type QueueJobStatus = "PENDING" | "BLOCKED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface QueuePayload {
  userId: string;
  provider?: PortalProvider;
  lectureSeq?: number;
  autoLearnMode?: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";
  courseContentsSeq?: number;
  reason?: string;
  chainSegment?: number;
  chainElapsedSeconds?: number;
}

export interface Cu12Credentials {
  cu12Id: string;
  cu12Password: string;
  campus: PortalCampus;
}

export interface PortalCredentials {
  provider: PortalProvider;
  loginId: string;
  password: string;
  campus?: PortalCampus | null;
}

