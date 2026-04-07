import {
  parseMyCourseHtml,
  parseNoticeListHtml,
  parseNotificationListHtml,
  parseTodoTasks,
  selectPreferredNoticeBody,
  shouldResolveNoticeDetailBody,
  type CourseNotice,
  type CourseState,
  type LearningTask,
  type NotificationEvent,
} from "@cu12/core";
import { type Browser, type BrowserContextOptions, type Locator, type Page } from "playwright";
import { getEnv } from "./env";
import { generateQuizAnswer, type QuizPromptItem, type QuizPromptOption } from "./openai";

export interface Cu12Credentials {
  cu12Id: string;
  cu12Password: string;
  campus: "SONGSIM" | "SONGSIN";
}

export interface SyncSnapshotResult {
  courses: CourseState[];
  notices: CourseNotice[];
  notifications: NotificationEvent[];
  tasks: LearningTask[];
}

export interface SyncProgress {
  phase: "COURSES" | "NOTICES" | "TASKS" | "NOTIFICATIONS" | "DONE";
  totalCourses: number;
  completedCourses: number;
  noticeCount: number;
  taskCount: number;
  notificationCount: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  current?: {
    lectureSeq: number;
    title: string;
  };
}

export type AutoLearnMode = "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";

interface PlannedTask {
  lectureSeq: number;
  courseTitle: string;
  task: LearningTask;
  remainingSeconds: number;
}

export type AutoLearnNoOpReason =
  | "NO_ACTIVE_COURSES"
  | "LECTURE_NOT_FOUND"
  | "NO_PENDING_TASKS"
  | "NO_PENDING_SUPPORTED_TASKS"
  | "NO_AVAILABLE_SUPPORTED_TASKS"
  | "NO_TASKS_AFTER_FILTER";

export interface AutoLearnPlannedTask {
  lectureSeq: number;
  courseContentsSeq: number;
  courseTitle: string;
  weekNo: number;
  lessonNo: number;
  taskTitle: string;
  state: LearningTask["state"];
  activityType: LearningTask["activityType"];
  requiredSeconds: number;
  learnedSeconds: number;
  availableFrom: string | null;
  dueAt: string | null;
  remainingSeconds: number;
}

export interface AutoLearnProgress {
  phase: "PLANNING" | "RUNNING" | "DONE";
  mode: AutoLearnMode;
  totalTasks: number;
  completedTasks: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number;
  noOpReason?: AutoLearnNoOpReason | null;
  plannedTaskCount?: number;
  planned?: AutoLearnPlannedTask[];
  truncated?: boolean;
  heartbeatAt?: string;
  current?: {
    lectureSeq: number;
    weekNo: number;
    lessonNo: number;
    activityType: LearningTask["activityType"];
    remainingSeconds: number;
    elapsedSeconds?: number;
    courseTitle?: string;
    taskTitle?: string;
    questionIndex?: number;
    questionCount?: number;
    attemptsUsed?: number;
    attemptsLimit?: number;
  };
}

export interface AutoLearnResult {
  mode: AutoLearnMode;
  processedTaskCount: number;
  elapsedSeconds: number;
  lectureSeqs: number[];
  plannedTaskCount: number;
  truncated: boolean;
  continuationQueued?: boolean;
  chainLimitReached?: boolean;
  chainSegment?: number;
  noOpReason?: AutoLearnNoOpReason | null;
  planned?: AutoLearnPlannedTask[];
  estimatedTotalSeconds: number;
}

interface PlanResult {
  planned: PlannedTask[];
  noOpReason: AutoLearnNoOpReason | null;
}

interface ChunkSelection {
  planned: PlannedTask[];
  estimatedTotalSeconds: number;
  truncated: boolean;
}

type SupportedAutoLearnActivityType = Extract<LearningTask["activityType"], "VOD" | "MATERIAL" | "QUIZ">;
type TaskExecutionKind = SupportedAutoLearnActivityType;

interface TaskExecutionResult {
  activityType: TaskExecutionKind;
  elapsedSeconds: number;
  questionIndex?: number;
  questionCount?: number;
  attemptsUsed?: number;
  attemptsLimit?: number;
}

interface BuildTaskPlanInput {
  mode: AutoLearnMode;
  lectureSeqs: number[];
  lectureSeq?: number;
  courseTitleBySeq: Map<number, string>;
  tasksByLecture: Map<number, LearningTask[]>;
  nowMs?: number;
}

interface QuizQuestionStateBase {
  kind: "CHOICE" | "TEXT" | "MATCH" | "ORDER";
  questionIndex: number;
  questionCount: number;
  questionNumber: string;
  questionTypeLabel: string;
  prompt: string;
  attemptsUsed: number;
  attemptsLimit: number;
  feedbackText: string | null;
}

interface QuizChoiceState extends QuizQuestionStateBase {
  kind: "CHOICE";
  multiple: boolean;
  options: QuizPromptOption[];
}

interface QuizTextState extends QuizQuestionStateBase {
  kind: "TEXT";
  inputIds: string[];
}

interface QuizMatchState extends QuizQuestionStateBase {
  kind: "MATCH";
  qSeq: string;
  sourceItems: QuizPromptItem[];
  answerItems: QuizPromptItem[];
}

interface QuizOrderState extends QuizQuestionStateBase {
  kind: "ORDER";
  qSeq: string;
  sourceItems: QuizPromptItem[];
  answerItems: QuizPromptItem[];
}

type QuizQuestionState = QuizChoiceState | QuizTextState | QuizMatchState | QuizOrderState;

export interface QuizTransitionState {
  questionIndex: number;
  questionCount: number;
  attemptsUsed: number;
  attemptsLimit: number;
}

export type QuizTransitionResult = "DONE" | "ADVANCED" | "RETRYABLE" | "STALLED" | "EXHAUSTED";

type CancelCheck = () => Promise<boolean>;
type PlaybackTick = (state: { elapsedSeconds: number; remainingSeconds: number }) => Promise<void> | void;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/124.0.0.0 Safari/537.36";

function createRealisticBrowserContextOptions(): BrowserContextOptions {
  const env = getEnv();
  return {
    userAgent: env.PLAYWRIGHT_USER_AGENT ?? DEFAULT_USER_AGENT,
    locale: env.PLAYWRIGHT_LOCALE,
    timezoneId: env.PLAYWRIGHT_TIMEZONE,
    extraHTTPHeaders: {
      "accept-language": env.PLAYWRIGHT_ACCEPT_LANGUAGE,
    },
    viewport: {
      width: env.PLAYWRIGHT_VIEWPORT_WIDTH,
      height: env.PLAYWRIGHT_VIEWPORT_HEIGHT,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randInt(min: number, max: number): number {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function isSupportedAutoLearnActivityType(activityType: LearningTask["activityType"]): activityType is SupportedAutoLearnActivityType {
  return activityType === "VOD" || activityType === "MATERIAL" || activityType === "QUIZ";
}

function getTaskRemainingSeconds(task: LearningTask): number {
  if (task.activityType !== "VOD") {
    return 0;
  }
  return Math.max(0, task.requiredSeconds - task.learnedSeconds);
}

function parseDateMsOrNull(value?: string | null): number | null {
  if (!value || typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinLearningWindow(task: LearningTask, nowMs: number): boolean {
  const availableFromMs = parseDateMsOrNull(task.availableFrom);
  if (availableFromMs !== null && nowMs < availableFromMs) return false;

  const dueAtMs = parseDateMsOrNull(task.dueAt);
  if (dueAtMs !== null && nowMs > dueAtMs) return false;

  return true;
}

function isAutoLearnableTask(task: LearningTask, nowMs: number): boolean {
  if (task.state !== "PENDING") return false;
  if (!isSupportedAutoLearnActivityType(task.activityType)) return false;
  if (task.activityType === "VOD" && task.requiredSeconds > 0 && task.learnedSeconds >= task.requiredSeconds) {
    return false;
  }
  return isWithinLearningWindow(task, nowMs);
}

function buildTaskPlan(input: BuildTaskPlanInput): PlanResult {
  const lectureSeqs =
    input.mode === "ALL_COURSES"
      ? input.lectureSeqs
      : input.lectureSeq
        ? [input.lectureSeq]
        : input.lectureSeqs;
  const nowMs = input.nowMs ?? Date.now();
  const planned: PlannedTask[] = [];
  const courseGroups: Array<{ lectureSeq: number; courseTitle: string; tasks: LearningTask[] }> = [];
  let pendingTaskCount = 0;
  let pendingSupportedTaskCount = 0;
  let availableSupportedTaskCount = 0;

  for (const seq of lectureSeqs) {
    const tasks = input.tasksByLecture.get(seq) ?? [];
    for (const task of tasks) {
      if (task.state !== "PENDING") continue;
      pendingTaskCount += 1;
      if (isSupportedAutoLearnActivityType(task.activityType)) {
        pendingSupportedTaskCount += 1;
      }
    }

    const pending = tasks
      .filter((task) => isAutoLearnableTask(task, nowMs))
      .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));
    availableSupportedTaskCount += pending.length;

    if (input.mode === "SINGLE_NEXT") {
      const next = pending[0];
      if (next) {
        planned.push({
          lectureSeq: seq,
          courseTitle: input.courseTitleBySeq.get(seq) ?? `Course ${seq}`,
          task: next,
          remainingSeconds: getTaskRemainingSeconds(next),
        });
      }
      continue;
    }

    if (pending.length === 0) continue;
    courseGroups.push({
      lectureSeq: seq,
      courseTitle: input.courseTitleBySeq.get(seq) ?? `Course ${seq}`,
      tasks: pending,
    });
  }

  let roundRobinIndex = 0;
  while (true) {
    let addedAtRound = false;
    for (const group of courseGroups) {
      const task = group.tasks[roundRobinIndex];
      if (!task) continue;

      planned.push({
        lectureSeq: group.lectureSeq,
        courseTitle: group.courseTitle,
        task,
        remainingSeconds: getTaskRemainingSeconds(task),
      });
      addedAtRound = true;
    }

    if (!addedAtRound) break;
    roundRobinIndex += 1;
  }

  let noOpReason: AutoLearnNoOpReason | null = null;
  if (planned.length === 0) {
    if (pendingTaskCount === 0) {
      noOpReason = "NO_PENDING_TASKS";
    } else if (pendingSupportedTaskCount === 0) {
      noOpReason = "NO_PENDING_SUPPORTED_TASKS";
    } else if (availableSupportedTaskCount === 0) {
      noOpReason = "NO_AVAILABLE_SUPPORTED_TASKS";
    } else {
      noOpReason = "NO_TASKS_AFTER_FILTER";
    }
  }

  return { planned, noOpReason };
}

function interpretQuizTransition(
  previous: QuizTransitionState,
  next: QuizTransitionState | null,
  isResultPage: boolean,
): QuizTransitionResult {
  if (isResultPage) return "DONE";
  if (!next) return "STALLED";
  if (next.questionIndex !== previous.questionIndex || next.questionCount !== previous.questionCount) {
    return "ADVANCED";
  }
  if (next.attemptsUsed > previous.attemptsUsed) {
    return next.attemptsUsed < next.attemptsLimit ? "RETRYABLE" : "EXHAUSTED";
  }
  return "STALLED";
}

function isTaskPendingInTaskList(task: LearningTask, tasks: LearningTask[]): boolean {
  return tasks.some((candidate) =>
    candidate.lectureSeq === task.lectureSeq
    && candidate.courseContentsSeq === task.courseContentsSeq
    && candidate.state === "PENDING");
}

function selectChunkTasks(plannedAll: PlannedTask[], env = getEnv()): ChunkSelection {
  const maxTasks = Math.max(1, env.AUTOLEARN_MAX_TASKS);
  const targetSeconds = Math.max(300, env.AUTOLEARN_CHUNK_TARGET_SECONDS);
  const planned: PlannedTask[] = [];
  let estimatedTotalSeconds = 0;

  for (const row of plannedAll) {
    if (planned.length >= maxTasks) break;
    const rowSeconds = Math.max(1, Math.ceil(row.remainingSeconds * env.AUTOLEARN_TIME_FACTOR));
    const wouldExceedTarget = estimatedTotalSeconds + rowSeconds > targetSeconds;

    if (planned.length > 0 && wouldExceedTarget) {
      break;
    }

    planned.push(row);
    estimatedTotalSeconds += rowSeconds;
  }

  if (planned.length === 0 && plannedAll.length > 0) {
    const first = plannedAll[0];
    const firstSeconds = Math.max(1, Math.ceil(first.remainingSeconds * env.AUTOLEARN_TIME_FACTOR));
    planned.push(first);
    estimatedTotalSeconds = firstSeconds;
  }

  return {
    planned,
    estimatedTotalSeconds,
    truncated: planned.length < plannedAll.length,
  };
}

async function humanPause(page: Page, minMs: number, maxMs: number, shouldCancel?: CancelCheck): Promise<void> {
  const targetMs = randInt(minMs, maxMs);
  let remainingMs = targetMs;

  while (remainingMs > 0) {
    if (shouldCancel && await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const chunkMs = Math.min(500, remainingMs);
    await page.waitForTimeout(chunkMs);
    remainingMs -= chunkMs;
  }
}

async function humanType(locator: Locator, value: string, minDelayMs: number, maxDelayMs: number): Promise<void> {
  const charDelay = randInt(minDelayMs, maxDelayMs);
  await locator.click({ delay: randInt(20, 120) });
  await locator.fill("");
  await locator.type(value, { delay: charDelay });
}

function installDialogHandler(page: Page) {
  page.on("dialog", async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // Ignore dialog handling failures
    }
  });
}

async function ensureLogin(page: Page, creds: Cu12Credentials) {
  const env = getEnv();
  const useHumanization = env.AUTOLEARN_HUMANIZATION_ENABLED;
  await page.goto(`${env.CU12_BASE_URL}/el/member/login_form.acl`, { waitUntil: "domcontentloaded" });

  const catholicUniversityButton = page.locator("#catholic");
  if (await catholicUniversityButton.count()) {
    if (useHumanization) {
      await catholicUniversityButton.first().click({ delay: randInt(20, 120) });
    } else {
      await catholicUniversityButton.first().click();
    }
    if (useHumanization) {
      await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS);
    }
  }

  const songsinRadio = page.locator('input[name="catholic_dv"][value="songsin"]');
  if (creds.campus === "SONGSIN" && (await songsinRadio.count())) {
    await songsinRadio.check();
    if (useHumanization) {
      await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS);
    }
  }

  const idInput = page.locator("#usr_id2, #usr_id").first();
  const pwInput = page.locator("#pwd2, #pwd").first();
  const loginButton = page.locator("#loginBtn_check2, #loginBtn_check1").first();

  if (useHumanization) {
    await humanType(idInput, creds.cu12Id, env.AUTOLEARN_TYPING_DELAY_MIN_MS, env.AUTOLEARN_TYPING_DELAY_MAX_MS);
    await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS);
    await humanType(pwInput, creds.cu12Password, env.AUTOLEARN_TYPING_DELAY_MIN_MS, env.AUTOLEARN_TYPING_DELAY_MAX_MS);
    await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS);
    await loginButton.click({ delay: randInt(20, 120) });
  } else {
    await idInput.fill(creds.cu12Id);
    await pwInput.fill(creds.cu12Password);
    await loginButton.click();
  }

  await page.waitForURL(/\/el\/(main\/main_form|member\/mycourse_list_form)\.acl/, {
    timeout: 20000,
  });
}

async function fetchNoticeBodies(page: Page, lectureSeq: number): Promise<Array<{ noticeSeq: string; bodyText: string }>> {
  return page.evaluate(async (seq) => {
    const normalize = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    const waitMs = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    function stripMarkup(container: HTMLElement): string {
      container.querySelectorAll("script, style, link").forEach((node) => node.remove());
      return normalize(container.textContent ?? "");
    }

    function extractNoticeSeqFromNode(node: Element): string | null {
      const id = node.getAttribute("id")?.trim();
      const idMatch = id?.match(/notice_tit_(\d+)/)?.[1];
      if (idMatch) return idMatch;

      const onclick = node.getAttribute("onclick") ?? "";
      const onClickMatch =
        onclick.match(/noticeShow\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeShow\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeView\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/noticeView\(\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/notice_open\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1]
        ?? onclick.match(/notiOpen\(\s*['"]?\d+['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/)?.[1];
      if (onClickMatch) return onClickMatch;

      const dataNoticeSeq =
        node.getAttribute("data-notice-seq")
        ?? node.getAttribute("data-notice_seq")
        ?? node.getAttribute("data-artl-seq")
        ?? node.getAttribute("data-notice-id")
        ?? node.getAttribute("data-seq");
      if (dataNoticeSeq) return dataNoticeSeq;

      const anchor = node.getAttribute("href") ?? "";
      const hrefMatch =
        anchor.match(/noticeView\.acl[^?]*\?[^#]*notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/notice_seq=(\d+)/i)?.[1]
        ?? anchor.match(/artl_seq=(\d+)/i)?.[1]
        ?? anchor.match(/A_SEQ=(\d+)/i)?.[1]
        ?? anchor.match(/notice_id=(\d+)/i)?.[1];
      if (hrefMatch) return hrefMatch;

      return null;
    }

    function collectNoticeSeqs(): string[] {
      const rawNodes = [
        ...Array.from(document.querySelectorAll("button.notice_title[id^='notice_tit_'], button.notice_title, a.notice_title")),
        ...Array.from(
          document.querySelectorAll(
            "button.notice_title[id^='notice_tit_'], button.notice_title, a.notice_title, .notice_title, [onclick*='noticeShow'], [onclick*='noticeView'], [onclick*='notice_open'], [onclick*='notiOpen'], [data-notice-seq], [data-notice_seq], [data-artl-seq], [data-seq], .notification_title, .class_notice_title, a[href*='A_SEQ='], a[href*='notice_seq='], a[href*='artl_seq='], a[href*='notice_list_form.acl']",
          ),
        ),
      ];

      const seqs = rawNodes
        .map((node) => extractNoticeSeqFromNode(node))
        .filter((seq): seq is string => Boolean(seq));

      return Array.from(new Set(seqs));
    }

    function extractNoticeDetailUrlFromNode(node: Element, noticeSeqHint?: string): string | null {
      const href = (node.getAttribute("href") ?? "").trim();
      const onclick = node.getAttribute("onclick") ?? "";
      const pageGoUrl =
        href.match(/pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? onclick.match(/pageGo\(\s*['"]([^'"]+)['"]\s*\)/i)?.[1]
        ?? "";

      const normalized = (pageGoUrl || href).replace(/&amp;/gi, "&").trim();
      if (!normalized) return null;

      if (/^https?:\/\//i.test(normalized)) {
        return /notice_list_form\.acl/i.test(normalized) ? normalized : null;
      }
      if (normalized.startsWith("/")) {
        return /notice_list_form\.acl/i.test(normalized) ? normalized : null;
      }
      if (/notice_list_form\.acl/i.test(normalized)) {
        return normalized.startsWith("?") ? `/el/class/notice_list_form.acl${normalized}` : normalized;
      }

      const noticeSeq = noticeSeqHint ?? extractNoticeSeqFromNode(node);
      if (!noticeSeq) return null;
      return `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}&encoding=utf-8`;
    }

    function collectNoticeDetailUrlBySeq(): Map<string, string> {
      const map = new Map<string, string>();
      const nodes = Array.from(
        document.querySelectorAll(
          "a[href*='A_SEQ='], a[href*='notice_seq='], a[href*='artl_seq='], a[href*='notice_list_form.acl'], [onclick*='pageGo']",
        ),
      );

      for (const node of nodes) {
        const href = node.getAttribute("href") ?? "";
        const onclick = node.getAttribute("onclick") ?? "";
        const noticeSeq =
          extractNoticeSeqFromNode(node)
          ?? href.match(/[?&]A_SEQ=(\d+)/i)?.[1]
          ?? href.match(/[?&](?:NOTICE_SEQ|notice_seq|artl_seq)=(\d+)/i)?.[1]
          ?? onclick.match(/(?:A_SEQ|NOTICE_SEQ|notice_seq|artl_seq)=(\d+)/i)?.[1]
          ?? null;
        if (!noticeSeq) continue;

        const detailUrl = extractNoticeDetailUrlFromNode(node, noticeSeq);
        if (!detailUrl) continue;

        if (!map.has(noticeSeq)) {
          map.set(noticeSeq, detailUrl);
        }
      }

      return map;
    }

    function locateNoticeTrigger(seq: string): HTMLElement | null {
      const selectors = [
        `#notice_tit_${seq}`,
        `button.notice_title#notice_tit_${seq}`,
        `a.notice_title#notice_tit_${seq}`,
        `.notice_title[data-notice-seq='${seq}']`,
        `.notice_title[data-notice_seq='${seq}']`,
        `.notice_title[data-artl-seq='${seq}']`,
        `.notice_title[data-seq='${seq}']`,
        `[onclick*="noticeShow"]`,
        `[onclick*="noticeView"]`,
        `[onclick*="notice_open"]`,
        `[onclick*="notiOpen"]`,
      ];

      const directByClickText = Array.from(document.querySelectorAll(`a, button`))
        .find((candidate) =>
          extractNoticeSeqFromNode(candidate as Element) === seq
          && ['A', 'BUTTON'].includes((candidate as Element).tagName)
        );
      if (directByClickText) {
        return directByClickText as HTMLElement;
      }

      for (const selector of selectors) {
        const target = document.querySelector(selector) as HTMLElement | null;
        if (target && /notice/i.test(target.tagName)) return target;
        if (target && extractNoticeSeqFromNode(target) === seq) return target;
      }

      return null;
    }

    async function openNotice(seq: string): Promise<boolean> {
      if (!seq) return false;
      const trigger = locateNoticeTrigger(seq);
      if (!trigger) return false;

      try {
        trigger.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
      } catch {
        // Ignore scroll failures
      }

      try {
        trigger.click();
      } catch {
        // Ignore click failures
      }

      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const extracted = extractNoticeNodeFromHtml(document, seq);
        if (extracted) return true;
        await waitMs(150);
      }
      return false;
    }

    function extractNoticeNodeFromHtml(container: ParentNode, noticeSeq: string): HTMLElement | null {
      const selectors = [
        `#notice_${noticeSeq}`,
        `#notice_txt_${noticeSeq}`,
        `#notice-content-${noticeSeq}`,
        `#notice-content_${noticeSeq}`,
        `#notice_body_${noticeSeq}`,
        `.notice-content-${noticeSeq}`,
        `.notice-content_${noticeSeq}`,
        `.notice-body-${noticeSeq}`,
        `.notice_body_${noticeSeq}`,
        `.notice_${noticeSeq}`,
        `#board_${noticeSeq}`,
      ];

      for (const selector of selectors) {
        const node = container.querySelector(selector);
        if (node && normalize(node.textContent ?? "").length > 0) {
          return node as HTMLElement;
        }
      }

      return null;
    }

    function parseNoticeBodyFromHtml(rawHtml: string, noticeSeq: string): string {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = rawHtml;
      wrapper.querySelectorAll("script, style, link").forEach((node) => node.remove());
      const cleanupNoticeBody = (value: string): string =>
        normalize(value)
          .replace(/^(?:공지내용\s*(?:닫기\s*)?)+/i, "")
          .replace(/^해당 공지사항을 열람할 수 없습니다\.\s*/i, "")
          .trim();

      const candidates = [
        extractNoticeNodeFromHtml(wrapper, noticeSeq),
        wrapper.querySelector(
          ".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .cont, .txt, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view",
        ),
        wrapper.querySelector("textarea[name*='notice'], textarea[id*='notice'], textarea"),
        wrapper.querySelector(`#content_${noticeSeq}`),
        wrapper.querySelector(".notice_view"),
        wrapper.querySelector("#notice_view"),
        wrapper.querySelector(`#noticeArea_${noticeSeq}`),
      ];

      const body = candidates
        .map((node) => stripMarkup((node as HTMLElement) ?? document.createElement("span")))
        .find((text) => text.length > 0);

      if (body) {
        const cleaned = cleanupNoticeBody(body);
        if (cleaned) return cleaned;
      }

      const labelContainers = Array.from(wrapper.querySelectorAll("tr, li, dl, div, article"));
      for (const container of labelContainers) {
        const labelText = normalize(container.textContent ?? "");
        if (!labelText || !/공지내용/.test(labelText)) continue;

        const detailNodes = [
          container.querySelector("td"),
          container.querySelector("dd"),
          container.querySelector("textarea"),
          container.querySelector(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .cont, .txt, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view"),
          container.nextElementSibling,
        ];
        const detailText = detailNodes
          .map((node) => stripMarkup((node as HTMLElement) ?? document.createElement("span")))
          .find((text) => text.length > 0);
        if (detailText) {
          const cleaned = cleanupNoticeBody(detailText);
          if (cleaned) return cleaned;
        }
      }

      const textMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? rawHtml;
      const plainText = (textMatch ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]*>/g, " ");
      const labeledBody = plainText.match(/공지내용(?:\s*닫기)?\s*공지내용?\s*([\s\S]+)/i)?.[1] ?? plainText;
      return cleanupNoticeBody(labeledBody);
    }

    function extractContentsSeq(html: string): string | null {
      const matches = [
        /CONTENTS_SEQ\s*[:=]\s*["']?(\d+)["']?/i,
        /contentSeq\s*[:=]\s*["']?(\d+)["']?/i,
        /course_contents_seq\s*[:=]\s*["']?(\d+)["']?/i,
      ];
      for (const match of matches) {
        const found = html.match(match);
        if (found?.[1]) return found[1];
      }
      return null;
    }

    function extractAttachments(rawHtml: string): Array<{ name: string; url: string }> {
      const doc = document.createElement("div");
      doc.innerHTML = rawHtml;
      const directLinks = Array.from(
        doc.querySelectorAll("a[href*='file_download'], a[data-href*='file_download'], a[href*='download'], a[data-href*='download']"),
      )
        .map((link) => {
          const href = (link.getAttribute("href") ?? link.getAttribute("data-href") ?? "").trim();
          const name = normalize(link.textContent ?? "");
          return href && name ? { name, url: href } : null;
        })
        .filter((item): item is { name: string; url: string } => Boolean(item));

      if (directLinks.length > 0) {
        return dedupeAttachments(directLinks);
      }

      const fallbackRows = Array.from(doc.querySelectorAll("tr, li, .file-row, .item"))
        .map((row) => {
          const href =
            row.querySelector("a")?.getAttribute("href")?.trim()
            ?? row.querySelector("a")?.getAttribute("data-href")?.trim()
            ?? "";
          const name = normalize(row.textContent ?? "");
          return href && name ? { name, url: href } : null;
        })
        .filter((item): item is { name: string; url: string } => Boolean(item));

      return dedupeAttachments(fallbackRows);
    }

    function dedupeAttachments(rows: Array<{ name: string; url: string }>): Array<{ name: string; url: string }> {
      const seen = new Set<string>();
      return rows.filter((row) => {
        const key = normalize(row.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    async function requestText(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<string> {
      try {
        const response = await fetch(url, init as RequestInit);
        if (!response.ok) return "";
        return response.text();
      } catch {
        return "";
      }
    }

    async function resolveNoticeContent(
      noticeSeq: string,
    ): Promise<{ bodyText: string; attachments: Array<{ name: string; url: string }> }> {
      const scriptText = Array.from(document.querySelectorAll("script"))
        .map((script) => script.textContent ?? "")
        .join("\n");
      const mappedDetailUrl = detailUrlBySeq.get(noticeSeq) ?? null;

       const courseSeq = String(
         Number(
           document.querySelector('input[name="COURSE_SEQ"]')?.getAttribute("value")
           ?? scriptText.match(/COURSE_SEQ\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? scriptText.match(/course_seq\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? scriptText.match(/COURSESEQ\s*[:=]\s*["']?(\d+)["']?/i)?.[1]
           ?? String(seq),
         ),
       );

      const queryBody = new URLSearchParams({
        COURSE_SEQ: courseSeq,
        LECTURE_SEQ: String(seq),
        CUR_LECTURE_SEQ: String(seq),
        NOTICE_SEQ: noticeSeq,
        ARTL_SEQ: noticeSeq,
        CONTENTS_SEQ: noticeSeq,
        artl_seq: noticeSeq,
        notice_seq: noticeSeq,
        A_SEQ: noticeSeq,
        ARTL_NO: noticeSeq,
        NOTICE: noticeSeq,
        artl_no: noticeSeq,
        encoding: "utf-8",
      });

      const fallbackParams = new URLSearchParams({
        encoding: "utf-8",
        LECTURE_SEQ: String(seq),
        COURSE_SEQ: courseSeq,
        NOTICE_SEQ: noticeSeq,
        CUR_LECTURE_SEQ: String(seq),
        ARTL_SEQ: noticeSeq,
      });

      const queryBodyString = queryBody.toString();
      const fallbackQueryBodyString = fallbackParams.toString();
      const detailCandidates = [
        ...(mappedDetailUrl ? [{ method: "GET", url: mappedDetailUrl }] : []),
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&A_SEQ=${noticeSeq}` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&NOTICE_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?LECTURE_SEQ=${seq}&ARTL_SEQ=${noticeSeq}&encoding=utf-8` },
        { method: "POST", url: "/el/class/notice_list.acl", body: queryBodyString },
        { method: "POST", url: "/el/class/notice_list.acl", body: `${queryBodyString}&mode=ajax` },
        { method: "POST", url: "/el/class/notice_list.acl", body: `NOTICE_SEQ=${noticeSeq}&COURSE_SEQ=${courseSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&COURSE_SEQ=${courseSeq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list.acl?${queryBodyString}` },
        { method: "POST", url: "/el/class/notice_list_form.acl", body: queryBodyString },
        { method: "POST", url: "/el/class/notice_list_form.acl", body: `NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "GET", url: `/el/class/notice_list_form.acl?NOTICE_SEQ=${noticeSeq}&LECTURE_SEQ=${seq}&encoding=utf-8` },
        { method: "POST", url: "/el/co/notice_detail.acl", body: queryBodyString },
        { method: "GET", url: `/el/class/notice_view_form.acl?${fallbackQueryBodyString}` },
        { method: "POST", url: "/el/class/notice_view_form.acl", body: queryBodyString },
        { method: "GET", url: `/el/class/notice_view_form.acl?${queryBodyString}` },
      ];

      const requestHtmls: string[] = [];
      await openNotice(noticeSeq);
      const inlineNode = extractNoticeNodeFromHtml(document, noticeSeq);
      if (inlineNode) {
        const inlineText = stripMarkup(inlineNode as HTMLElement);
        if (inlineText) requestHtmls.push(`<div>${inlineText}</div>`);
      }

      for (const request of detailCandidates) {
        const text = await requestText(request.url, {
          method: request.method,
          headers: request.method === "POST" ? { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } : undefined,
          ...(request.method === "POST" ? { body: request.body } : {}),
        });
        if (text) requestHtmls.push(text);
      }

      for (const raw of requestHtmls) {
        const bodyText = parseNoticeBodyFromHtml(raw, noticeSeq);
        if (!bodyText) continue;

        const attachments = dedupeAttachments(extractAttachments(raw));
        const contentsSeq = extractContentsSeq(raw);

        if (contentsSeq) {
          const fileListText = await requestText(
            `/el/co/file_list_user4.acl?CONTENTS_SEQ=${contentsSeq}&LECTURE_SEQ=${seq}&encoding=utf-8`,
          );
          const fileAttachments = dedupeAttachments([...attachments, ...extractAttachments(fileListText)]);
          if (fileAttachments.length > 0) {
            return { bodyText, attachments: fileAttachments };
          }
        }

        return { bodyText, attachments };
      }

      return { bodyText: "", attachments: [] };
    }

    const noticeSeqs = collectNoticeSeqs();
    const detailUrlBySeq = collectNoticeDetailUrlBySeq();
    const fallbackNoticeSeqs = Array.from(document.querySelectorAll<HTMLButtonElement>("[id*='notice_tit_'], .notice_title"))
      .map((button) => button.id.match(/(\d+)/)?.[1] ?? "")
      .filter((noticeSeq) => noticeSeq.length > 0);
    const normalizedSeqs = noticeSeqs.length > 0 ? noticeSeqs : fallbackNoticeSeqs;

    const results: Array<{ noticeSeq: string; bodyText: string }> = [];
    const cached = new Map<string, string>();
    for (const noticeSeq of normalizedSeqs) {
      try {
        if (cached.has(noticeSeq)) {
          const bodyText = cached.get(noticeSeq) ?? "";
          results.push({ noticeSeq, bodyText });
          continue;
        }

        const { bodyText, attachments } = await resolveNoticeContent(noticeSeq);
        const attachmentBlock =
          attachments.length === 0
            ? ""
            : `\n\n[첨부파일]\n${attachments.map((file) => `- ${file.name} (${file.url})`).join("\n")}`;
        const normalizedBody = `${bodyText}${attachmentBlock}`.trim();
        cached.set(noticeSeq, normalizedBody);
        results.push({ noticeSeq, bodyText: normalizedBody });
      } catch {
        results.push({ noticeSeq, bodyText: "" });
      }
    }

    return results;
  }, lectureSeq);
}

async function extractNoticeBodyFromCurrentPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const cleanup = (text: string): string =>
      normalize(text)
        .replace(/^(?:공지내용\s*(?:닫기\s*)?)+/i, "")
        .replace(/^해당 공지사항을 열람할 수 없습니다\.\s*/i, "")
        .trim();

    const readNodeText = (node: Element | null): string => {
      if (!node) return "";
      if (node instanceof HTMLTextAreaElement) {
        return cleanup(node.value || node.textContent || "");
      }

      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, link").forEach((child) => child.remove());
      return cleanup(clone.textContent ?? "");
    };

    const selectors = [
      ".class_notice_content",
      ".class_notice_body",
      ".editor_content",
      ".view_cont",
      ".notice_cont",
      ".bbs_notice",
      ".bbs_contents",
      ".notice_content",
      ".notice_body",
      ".bbs_view",
      "textarea[name*='notice']",
      "textarea[id*='notice']",
      "textarea",
    ];

    for (const selector of selectors) {
      const text = readNodeText(document.querySelector(selector));
      if (text) return text;
    }

    const labelContainers = Array.from(document.querySelectorAll("tr, li, dl, div, article, section"));
    for (const container of labelContainers) {
      const labelText = normalize(container.textContent ?? "");
      if (!labelText || !/공지내용/.test(labelText)) continue;

      const detailNodes = [
        container.querySelector("td"),
        container.querySelector("dd"),
        container.querySelector("textarea"),
        container.querySelector(".class_notice_content, .class_notice_body, .editor_content, .view_cont, .notice_cont, .bbs_notice, .bbs_contents, .notice_content, .notice_body, .bbs_view"),
        container.nextElementSibling,
      ];
      for (const node of detailNodes) {
        const text = readNodeText(node);
        if (text) return text;
      }
    }

    const plainText = normalize(document.body?.innerText ?? document.documentElement?.textContent ?? "");
    const matched = plainText.match(/공지내용(?:\s*닫기)?\s*공지내용?\s*([\s\S]+)/i)?.[1] ?? plainText;
    return cleanup(matched);
  });
}

async function installEvaluateCompatShim(page: Page) {
  await page.addInitScript(() => {
    const globalScope = globalThis as unknown as {
      __name?: (target: unknown, key?: string) => unknown;
    };
    if (typeof globalScope.__name !== "function") {
      globalScope.__name = (target) => target;
    }
  });
}

async function fetchNoticeBodiesFromDetailPages(
  page: Page,
  lectureSeq: number,
  noticeSeqs: string[],
): Promise<Map<string, string>> {
  const env = getEnv();
  const bodyByNoticeSeq = new Map<string, string>();
  const uniqueSeqs = Array.from(new Set(noticeSeqs.filter((noticeSeq) => /^\d+$/.test(noticeSeq))));

  for (const noticeSeq of uniqueSeqs) {
    const urls = [
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&A_SEQ=${noticeSeq}&encoding=utf-8`,
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&NOTICE_SEQ=${noticeSeq}&encoding=utf-8`,
      `${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${lectureSeq}&ARTL_SEQ=${noticeSeq}&encoding=utf-8`,
    ];

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      } catch {
        continue;
      }

      const bodyText = (await extractNoticeBodyFromCurrentPage(page)).trim();
      if (!bodyText) continue;

      bodyByNoticeSeq.set(noticeSeq, bodyText);
      break;
    }
  }

  return bodyByNoticeSeq;
}

async function fetchNotificationHtml(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/el/co/notification_list.acl", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "encoding=utf-8",
    });
    return response.text();
  });
}

export async function collectCu12Snapshot(
  browser: Browser,
  userId: string,
  creds: Cu12Credentials,
  onCancelCheck?: CancelCheck,
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
): Promise<SyncSnapshotResult> {
  const env = getEnv();
  const context = await browser.newContext(createRealisticBrowserContextOptions());
  const page = await context.newPage();
  const shouldCancel = onCancelCheck ?? (async () => false);
  const reportProgress = async (progress: SyncProgress) => {
    if (!onProgress) return;
    try {
      await onProgress(progress);
    } catch {
      // Ignore progress reporting failures.
    }
  };
  installDialogHandler(page);
  await installEvaluateCompatShim(page);
  const startedAtMs = Date.now();
  const buildTiming = (completedCourses: number, totalCourses: number) => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
    const remainingCourses = Math.max(0, totalCourses - completedCourses);
    const estimatedRemainingSeconds = completedCourses > 0
      ? Math.max(0, Math.ceil((elapsedSeconds / completedCourses) * remainingCourses))
      : null;
    return { elapsedSeconds, estimatedRemainingSeconds };
  };

  try {
    await ensureLogin(page, creds);

    if (await shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const myCourseHtml = await page.content();
    const courses = parseMyCourseHtml(myCourseHtml, userId, "ACTIVE");

    const notices: CourseNotice[] = [];
    const tasks: LearningTask[] = [];
    let completedCourses = 0;

    await reportProgress({
      phase: "COURSES",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: 0,
      ...buildTiming(completedCourses, courses.length),
    });

    for (const course of courses) {
      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await reportProgress({
        phase: "NOTICES",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });

      await page.goto(`${env.CU12_BASE_URL}/el/class/notice_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      const noticeList = parseNoticeListHtml(await page.content(), userId, course.lectureSeq);
      const noticeBodies = await fetchNoticeBodies(page, course.lectureSeq);
      const bodiesByNoticeSeq = new Map(noticeBodies.map((item) => [item.noticeSeq, item.bodyText]));
      let resolvedNotices = noticeList.map((notice) => {
        const bodyText = notice.noticeSeq ? bodiesByNoticeSeq.get(notice.noticeSeq) : undefined;
        return {
          ...notice,
          bodyText: selectPreferredNoticeBody(notice.bodyText, bodyText),
        };
      });

      const missingBodyNoticeSeqs = Array.from(
        new Set(
          resolvedNotices
            .filter((notice) => notice.noticeSeq && shouldResolveNoticeDetailBody(notice.bodyText))
            .map((notice) => String(notice.noticeSeq)),
        ),
      );

      if (missingBodyNoticeSeqs.length > 0) {
        const detailBodiesBySeq = await fetchNoticeBodiesFromDetailPages(page, course.lectureSeq, missingBodyNoticeSeqs);
        resolvedNotices = resolvedNotices.map((notice) => {
          const noticeSeq = notice.noticeSeq ? String(notice.noticeSeq) : "";
          if (!noticeSeq) return notice;
          const detailBodyText = detailBodiesBySeq.get(noticeSeq);
          if (!detailBodyText) return notice;
          return {
            ...notice,
            bodyText: selectPreferredNoticeBody(notice.bodyText, detailBodyText),
          };
        });
      }

      notices.push(...resolvedNotices);

      if (await shouldCancel()) {
        throw new Error("JOB_CANCELLED");
      }

      await reportProgress({
        phase: "TASKS",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });

      await page.goto(`${env.CU12_BASE_URL}/el/class/todo_list_form.acl?LECTURE_SEQ=${course.lectureSeq}`, {
        waitUntil: "domcontentloaded",
      });
      tasks.push(...parseTodoTasks(await page.content(), userId, course.lectureSeq));
      completedCourses += 1;

      await reportProgress({
        phase: "COURSES",
        totalCourses: courses.length,
        completedCourses,
        noticeCount: notices.length,
        taskCount: tasks.length,
        notificationCount: 0,
        ...buildTiming(completedCourses, courses.length),
        current: {
          lectureSeq: course.lectureSeq,
          title: course.title,
        },
      });
    }

    if (await shouldCancel()) {
      throw new Error("JOB_CANCELLED");
    }

    await reportProgress({
      phase: "NOTIFICATIONS",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: 0,
      ...buildTiming(completedCourses, courses.length),
    });

    await page.goto(`${env.CU12_BASE_URL}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
    const notificationHtml = await fetchNotificationHtml(page);
    const notifications = parseNotificationListHtml(notificationHtml, userId);

    await reportProgress({
      phase: "DONE",
      totalCourses: courses.length,
      completedCourses,
      noticeCount: notices.length,
      taskCount: tasks.length,
      notificationCount: notifications.length,
      ...buildTiming(courses.length, courses.length),
    });

    return { courses, notices, notifications, tasks };
  } finally {
    await context.close();
  }
}

async function waitForPlayback(
  page: Page,
  waitSeconds: number,
  shouldCancel: CancelCheck,
  onTick?: PlaybackTick,
): Promise<void> {
  const env = getEnv();
  const useHumanization = env.AUTOLEARN_HUMANIZATION_ENABLED;
  let remainingMs = Math.max(0, waitSeconds * 1000);
  const totalMs = remainingMs;
  const minTickMs = useHumanization ? 800 : 1000;
  const maxTickMs = useHumanization ? 1200 : 1000;

  while (remainingMs > 0) {
    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const chunkMs = Math.min(randInt(minTickMs, maxTickMs), remainingMs);
    await page.waitForTimeout(chunkMs);
    remainingMs -= chunkMs;
    if (onTick) {
      const elapsedSeconds = Math.floor((totalMs - remainingMs) / 1000);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      await onTick({ elapsedSeconds, remainingSeconds });
    }
  }
}

async function watchVodTask(
  page: Page,
  lectureSeq: number,
  task: LearningTask,
  shouldCancel: CancelCheck,
  onTick?: PlaybackTick,
): Promise<number> {
  const env = getEnv();
  const useHumanization = env.AUTOLEARN_HUMANIZATION_ENABLED;
  const remainingSeconds = Math.max(0, task.requiredSeconds - task.learnedSeconds);
  if (remainingSeconds <= 0) {
    return 0;
  }

  const waitSeconds = Math.ceil(remainingSeconds * env.AUTOLEARN_TIME_FACTOR);
  const targetUrl = `${env.CU12_BASE_URL}/el/class/contents_vod_view_form.acl?LECTURE_SEQ=${lectureSeq}&COURSE_CONTENTS_SEQ=${task.courseContentsSeq}&WEEK_NO=${task.weekNo}&LESSNS_NO=${task.lessonNo}`;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (useHumanization) {
    await humanPause(page, env.AUTOLEARN_NAV_SETTLE_MIN_MS, env.AUTOLEARN_NAV_SETTLE_MAX_MS, shouldCancel);
  } else {
    await page.waitForTimeout(3000);
  }

  // The service records attendance by periodic heartbeats during playback;
  // we keep the page open for the remaining required time.
  await waitForPlayback(page, waitSeconds, shouldCancel, onTick);

  await page.evaluate(() => {
    const fn = (window as unknown as { pageExit?: (isExit?: boolean) => void }).pageExit;
    if (typeof fn === "function") {
      fn(false);
    }
  });

  if (useHumanization) {
    await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS, shouldCancel);
  } else {
    await page.waitForTimeout(2000);
  }
  return waitSeconds;
}

async function fetchLectureTasks(
  page: Page,
  envBaseUrl: string,
  userId: string,
  lectureSeq: number,
): Promise<LearningTask[]> {
  await page.goto(`${envBaseUrl}/el/class/todo_list_form.acl?LECTURE_SEQ=${lectureSeq}`, {
    waitUntil: "domcontentloaded",
  });
  return parseTodoTasks(await page.content(), userId, lectureSeq);
}

async function ensureTaskCompleted(
  page: Page,
  envBaseUrl: string,
  userId: string,
  task: LearningTask,
): Promise<void> {
  const refreshedTasks = await fetchLectureTasks(page, envBaseUrl, userId, task.lectureSeq);
  if (isTaskPendingInTaskList(task, refreshedTasks)) {
    throw new Error(`AUTOLEARN_TASK_NOT_COMPLETED:${task.activityType}:${task.courseContentsSeq}`);
  }
}

async function completeMaterialTask(
  page: Page,
  envBaseUrl: string,
  userId: string,
  row: PlannedTask,
  shouldCancel: CancelCheck,
): Promise<TaskExecutionResult> {
  const env = getEnv();
  const startedAtMs = Date.now();
  const targetUrl =
    `${env.CU12_BASE_URL}/el/class/contents_material_view_form.acl`
    + `?LECTURE_SEQ=${row.lectureSeq}&COURSE_CONTENTS_SEQ=${row.task.courseContentsSeq}`
    + `&WEEK_NO=${row.task.weekNo}&LESSNS_NO=${row.task.lessonNo}`;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (env.AUTOLEARN_HUMANIZATION_ENABLED) {
    await humanPause(page, env.AUTOLEARN_NAV_SETTLE_MIN_MS, env.AUTOLEARN_NAV_SETTLE_MAX_MS, shouldCancel);
  } else {
    await page.waitForTimeout(1500);
  }

  await ensureTaskCompleted(page, envBaseUrl, userId, row.task);

  return {
    activityType: "MATERIAL",
    elapsedSeconds: Math.max(1, Math.floor((Date.now() - startedAtMs) / 1000)),
  };
}

function buildQuizAnswerSummary(question: QuizQuestionState, answer: { textAnswer?: string; selectedValues?: string[]; sequenceValues?: string[] }): string {
  if (question.kind === "TEXT") {
    return answer.textAnswer?.trim() ?? "";
  }
  if (question.kind === "CHOICE") {
    return (answer.selectedValues ?? []).join(",");
  }
  return (answer.sequenceValues ?? []).join(",");
}

async function openQuizQuestionForm(
  page: Page,
  lectureSeq: number,
  task: LearningTask,
  shouldCancel: CancelCheck,
): Promise<void> {
  const env = getEnv();
  const targetUrl =
    `${env.CU12_BASE_URL}/el/class/contents_quiz_view_form.acl`
    + `?LECTURE_SEQ=${lectureSeq}&COURSE_CONTENTS_SEQ=${task.courseContentsSeq}`
    + `&WEEK_NO=${task.weekNo}&LESSNS_NO=${task.lessonNo}&BRD_ID=C02`;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (env.AUTOLEARN_HUMANIZATION_ENABLED) {
    await humanPause(page, env.AUTOLEARN_NAV_SETTLE_MIN_MS, env.AUTOLEARN_NAV_SETTLE_MAX_MS, shouldCancel);
  } else {
    await page.waitForTimeout(1200);
  }

  if (/\/el\/class\/(?:contents_quiz_question_view_form|exam_question_form)\.acl/i.test(page.url())) {
    return;
  }

  const startButton = page.locator("button").filter({ hasText: "퀴즈 응시하기" }).first();
  if (await startButton.count()) {
    await startButton.click();
  } else {
    const agreeCheckbox = page.locator("#agreeTest");
    if (await agreeCheckbox.count()) {
      if (!(await agreeCheckbox.isChecked())) {
        await agreeCheckbox.check();
      }
      await page.evaluate(() => {
        const fn = (window as unknown as { startExam?: () => void }).startExam;
        if (typeof fn === "function") {
          fn();
        }
      });
    } else {
      await page.evaluate(() => {
        const fn = (window as unknown as { start?: () => void }).start;
        if (typeof fn === "function") {
          fn();
        }
      });
    }
  }

  await page.waitForURL(/\/el\/class\/(?:contents_quiz_question_view_form|exam_question_form|contents_quiz_question_result_view_form)\.acl/i, {
    timeout: 15000,
  });
}

async function readQuizQuestionState(page: Page): Promise<QuizQuestionState | null> {
  const state = await page.evaluate(() => {
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
    const pathname = window.location.pathname;
    if (/contents_quiz_question_result_view_form|exam_question_result_pop_form/i.test(pathname)) {
      return { done: true };
    }

    const questionIndex = Number(normalize(document.querySelector(".quiz_odr")?.textContent) || "0");
    const questionCountMatch =
      normalize(document.querySelector(".quiz_bottom")?.textContent).match(/(\d+)\s*\/\s*(\d+)/)
      ?? null;
    const questionCount = Number(questionCountMatch?.[2] ?? 0);
    const prompt = normalize(document.querySelector(".quiz_title > div")?.textContent);
    const questionTypeLabel = normalize(document.querySelector(".quiz_title .a_alt_span")?.textContent);
    const attemptsUsed = Number(normalize(document.querySelector("#try_cnt")?.textContent) || "0");
    const attemptsLimit = Number(normalize(document.querySelector("#limit_cnt")?.textContent) || "0");
    const feedbackText = Array.from(
      document.querySelectorAll(".quiz_feedback, .quiz_result, .quiz_answer_result, .answer_result, .wrong_answer, .correct_answer"),
    )
      .map((node) => normalize(node.textContent))
      .filter((value) => value.length > 0)
      .join(" ");
    const questionNumber = String((questionIndex || questionCountMatch?.[1]) ?? "");

    const textInputs = Array.from(
      document.querySelectorAll("#question_area input[type='text'], #question_area textarea"),
    )
      .filter((node) => node instanceof HTMLElement && !node.hasAttribute("disabled"))
      .map((node) => node.id)
      .filter((id) => id.length > 0);
    if (textInputs.length > 0) {
      return {
        kind: "TEXT",
        questionIndex,
        questionCount,
        questionNumber,
        questionTypeLabel,
        prompt,
        attemptsUsed,
        attemptsLimit,
        feedbackText: feedbackText || null,
        inputIds: textInputs,
      };
    }

    const choiceInputs = Array.from(document.querySelectorAll<HTMLInputElement>("#question_area input[name='check']"));
    if (choiceInputs.length > 0) {
      const questionScript = Array.from(document.querySelectorAll("#question_area script"))
        .map((node) => node.textContent ?? "")
        .join("\n");
      const multiSelect = /multi_select_yn\s*=\s*"Y"/.test(questionScript);
      const maxCount = Number(questionScript.match(/max_cnt\s*=\s*(\d+)/)?.[1] ?? "0");
      const options = choiceInputs.map((input) => {
        const value = String(input.value ?? "").trim();
        const suffix = input.id.replace(/^input_check_/, "");
        const label = normalize(document.querySelector(`#qtn_ex_${suffix}`)?.textContent);
        return { value, label };
      });
      return {
        kind: "CHOICE",
        questionIndex,
        questionCount,
        questionNumber,
        questionTypeLabel,
        prompt,
        attemptsUsed,
        attemptsLimit,
        feedbackText: feedbackText || null,
        multiple: multiSelect || maxCount > 1,
        options,
      };
    }

    const matchInputs = Array.from(document.querySelectorAll<HTMLInputElement>("[id^='MATCH_SETTING_ANS_']"));
    if (matchInputs.length > 0) {
      const qSeq = matchInputs[0]?.id.match(/^MATCH_SETTING_ANS_(\d+)_/)?.[1] ?? "";
      if (!qSeq) return { unsupported: true };

      const sourceItems = Array.from(document.querySelectorAll<HTMLInputElement>(`[id^='MATCH_EX_${qSeq}_']`))
        .map((node) => ({
          key: node.id.match(/^MATCH_EX_\d+_(\d+)$/)?.[1] ?? "",
          label: normalize(node.value || node.getAttribute("value") || node.textContent),
        }))
        .filter((item) => item.key.length > 0);
      const answerItems = Array.from(document.querySelectorAll<HTMLInputElement>(`[id^='MATCH_ANS_${qSeq}_']`))
        .map((node) => ({
          key: node.id.match(/^MATCH_ANS_\d+_(\d+)$/)?.[1] ?? "",
          label: normalize(node.value || node.getAttribute("value") || node.textContent),
        }))
        .filter((item) => item.key.length > 0);

      return {
        kind: "MATCH",
        qSeq,
        questionIndex,
        questionCount,
        questionNumber,
        questionTypeLabel,
        prompt,
        attemptsUsed,
        attemptsLimit,
        feedbackText: feedbackText || null,
        sourceItems,
        answerItems,
      };
    }

    const orderInputs = Array.from(document.querySelectorAll<HTMLInputElement>("[id^='ORDER_SETTING_ANS_']"));
    if (orderInputs.length > 0) {
      const qSeq = orderInputs[0]?.id.match(/^ORDER_SETTING_ANS_(\d+)_/)?.[1] ?? "";
      if (!qSeq) return { unsupported: true };

      const sourceItems = Array.from(document.querySelectorAll<HTMLElement>(`[id^='ORDER_EX_${qSeq}_']`))
        .map((node) => ({
          key: node.id.match(/^ORDER_EX_\d+_(\d+)$/)?.[1] ?? "",
          label: normalize((node as HTMLInputElement).value || node.getAttribute("value") || node.textContent),
        }))
        .filter((item) => item.key.length > 0);
      const answerItems = Array.from(document.querySelectorAll<HTMLElement>(`[id^='ORDER_ANS_${qSeq}_']`))
        .map((node) => ({
          key: node.id.match(/^ORDER_ANS_\d+_(\d+)$/)?.[1] ?? "",
          label: normalize((node as HTMLInputElement).value || node.getAttribute("value") || node.textContent),
        }))
        .filter((item) => item.key.length > 0);

      return {
        kind: "ORDER",
        qSeq,
        questionIndex,
        questionCount,
        questionNumber,
        questionTypeLabel,
        prompt,
        attemptsUsed,
        attemptsLimit,
        feedbackText: feedbackText || null,
        sourceItems,
        answerItems,
      };
    }

    return {
      unsupported: true,
      prompt,
      questionTypeLabel,
      questionIndex,
      questionCount,
    };
  });

  if (!state || typeof state !== "object") {
    return null;
  }
  if ("done" in state) {
    return null;
  }
  if ("unsupported" in state) {
    const unsupportedState = state as {
      prompt?: string;
      questionTypeLabel?: string;
      questionIndex?: number;
    };
    throw new Error(
      `QUIZ_UNSUPPORTED_CONTRACT:${unsupportedState.questionIndex ?? 0}:${unsupportedState.questionTypeLabel ?? "UNKNOWN"}:${unsupportedState.prompt ?? ""}`,
    );
  }
  return state as QuizQuestionState;
}

async function applyQuizAnswer(page: Page, question: QuizQuestionState, answer: Awaited<ReturnType<typeof generateQuizAnswer>>): Promise<void> {
  if (question.kind === "TEXT") {
    const fillValues = answer.textAnswer?.split(/\s*\|\|\s*|\n+/).map((value) => value.trim()).filter((value) => value.length > 0) ?? [];
    if (fillValues.length === 0) {
      throw new Error(`QUIZ_EMPTY_TEXT_ANSWER:${question.questionIndex}`);
    }

    const values = question.inputIds.length === 1
      ? [fillValues.join(" ")]
      : fillValues;
    if (values.length < question.inputIds.length) {
      throw new Error(`QUIZ_TEXT_INPUT_COUNT_MISMATCH:${question.questionIndex}`);
    }

    for (let index = 0; index < question.inputIds.length; index += 1) {
      const locator = page.locator(`#${question.inputIds[index]}`);
      await locator.fill(values[index] ?? values[values.length - 1] ?? "");
    }
    return;
  }

  if (question.kind === "CHOICE") {
    const selected = new Set((answer.selectedValues ?? []).map((value) => value.trim()));
    const fallback = question.options[0]?.value;
    if (selected.size === 0 && fallback) {
      selected.add(fallback);
    }

    await page.evaluate((selectedValues) => {
      const selectedSet = new Set(selectedValues);
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("#question_area input[name='check']"));
      for (const input of inputs) {
        const shouldSelect = selectedSet.has(String(input.value ?? "").trim());
        if (shouldSelect !== input.checked) {
          const suffix = input.id.replace(/^input_check_/, "");
          const fn = (window as unknown as { selectEx?: (no: string) => void }).selectEx;
          if (typeof fn === "function") {
            fn(String(suffix));
          }
        }
      }
    }, Array.from(selected));
    return;
  }

  if (question.kind === "MATCH" || question.kind === "ORDER") {
    const sequenceValues = answer.sequenceValues?.map((value) => value.trim()).filter((value) => value.length > 0)
      ?? question.answerItems.map((item) => item.key);
    if (sequenceValues.length < question.sourceItems.length) {
      throw new Error(`QUIZ_SEQUENCE_LENGTH_MISMATCH:${question.questionIndex}`);
    }

    await page.evaluate((payload) => {
      const prefix = payload.kind === "MATCH" ? "MATCH_SETTING_ANS_" : "ORDER_SETTING_ANS_";
      for (let index = 0; index < payload.sourceKeys.length; index += 1) {
        const sourceKey = payload.sourceKeys[index];
        const answerKey = payload.answerKeys[index] ?? "";
        const input = document.getElementById(`${prefix}${payload.qSeq}_${sourceKey}`) as HTMLInputElement | null;
        if (input) {
          input.value = answerKey;
        }
      }
    }, {
      kind: question.kind,
      qSeq: question.qSeq,
      sourceKeys: question.sourceItems.map((item) => item.key),
      answerKeys: sequenceValues,
    });
    return;
  }

  throw new Error("QUIZ_UNSUPPORTED_KIND");
}

async function submitQuizAnswer(page: Page): Promise<void> {
  await page.locator("#submit_btn").click();
}

async function waitForQuizTransition(
  page: Page,
  previous: QuizTransitionState,
): Promise<{ result: QuizTransitionResult; nextState: QuizQuestionState | null }> {
  const deadlineAt = Date.now() + 10000;

  while (Date.now() < deadlineAt) {
    if (/\/el\/class\/(?:contents_quiz_question_result_view_form|exam_question_result_pop_form)\.acl/i.test(page.url())) {
      return { result: "DONE", nextState: null };
    }

    const nextState = await readQuizQuestionState(page);
    const result = interpretQuizTransition(previous, nextState
      ? {
        questionIndex: nextState.questionIndex,
        questionCount: nextState.questionCount,
        attemptsUsed: nextState.attemptsUsed,
        attemptsLimit: nextState.attemptsLimit,
      }
      : null, false);

    if (result !== "STALLED") {
      return { result, nextState };
    }

    await page.waitForTimeout(200);
  }

  const nextState = await readQuizQuestionState(page);
  return {
    result: interpretQuizTransition(previous, nextState
      ? {
        questionIndex: nextState.questionIndex,
        questionCount: nextState.questionCount,
        attemptsUsed: nextState.attemptsUsed,
        attemptsLimit: nextState.attemptsLimit,
      }
      : null, /\/el\/class\/(?:contents_quiz_question_result_view_form|exam_question_result_pop_form)\.acl/i.test(page.url())),
    nextState,
  };
}

async function completeQuizTask(
  page: Page,
  envBaseUrl: string,
  row: PlannedTask,
  shouldCancel: CancelCheck,
  onQuestionProgress?: (question: QuizQuestionState) => Promise<void> | void,
): Promise<TaskExecutionResult> {
  const startedAtMs = Date.now();
  await openQuizQuestionForm(page, row.lectureSeq, row.task, shouldCancel);

  let lastQuestionIndex = 0;
  let lastQuestionCount = 0;
  let lastAttemptsUsed = 0;
  let lastAttemptsLimit = 0;
  const priorFailedAnswers: string[] = [];

  while (true) {
    if (await shouldCancel()) {
      throw new Error("AUTOLEARN_CANCELLED");
    }

    const question = await readQuizQuestionState(page);
    if (!question) {
      break;
    }

    lastQuestionIndex = question.questionIndex;
    lastQuestionCount = question.questionCount;
    lastAttemptsUsed = question.attemptsUsed;
    lastAttemptsLimit = question.attemptsLimit;

    if (onQuestionProgress) {
      await onQuestionProgress(question);
    }

    const answer = await generateQuizAnswer({
      courseTitle: row.courseTitle,
      weekNo: row.task.weekNo,
      lessonNo: row.task.lessonNo,
      quizTitle: row.task.taskTitle ?? `Quiz ${row.task.courseContentsSeq}`,
      questionIndex: question.questionIndex,
      questionCount: question.questionCount,
      questionType: question.questionTypeLabel,
      prompt: question.prompt,
      attemptsUsed: question.attemptsUsed,
      attemptsLimit: question.attemptsLimit,
      options: question.kind === "CHOICE" ? question.options : undefined,
      sourceItems: question.kind === "MATCH" || question.kind === "ORDER" ? question.sourceItems : undefined,
      answerItems: question.kind === "MATCH" || question.kind === "ORDER" ? question.answerItems : undefined,
      priorFailedAnswers,
      feedbackText: question.feedbackText,
    });

    await applyQuizAnswer(page, question, answer);
    await submitQuizAnswer(page);

    const previousState: QuizTransitionState = {
      questionIndex: question.questionIndex,
      questionCount: question.questionCount,
      attemptsUsed: question.attemptsUsed,
      attemptsLimit: question.attemptsLimit,
    };
    const transition = await waitForQuizTransition(page, previousState);

    if (transition.result === "DONE") {
      break;
    }

    if (transition.result === "ADVANCED") {
      continue;
    }

    if (transition.result === "RETRYABLE" && transition.nextState) {
      priorFailedAnswers.push(buildQuizAnswerSummary(question, answer));
      lastAttemptsUsed = transition.nextState.attemptsUsed;
      lastAttemptsLimit = transition.nextState.attemptsLimit;
      continue;
    }

    if (transition.result === "EXHAUSTED") {
      throw new Error(`QUIZ_ATTEMPTS_EXHAUSTED:${question.questionIndex}`);
    }

    throw new Error(`QUIZ_SUBMISSION_STALLED:${question.questionIndex}`);
  }

  await ensureTaskCompleted(page, envBaseUrl, row.task.userId, row.task);

  return {
    activityType: "QUIZ",
    elapsedSeconds: Math.max(1, Math.floor((Date.now() - startedAtMs) / 1000)),
    questionIndex: lastQuestionIndex,
    questionCount: lastQuestionCount,
    attemptsUsed: lastAttemptsUsed,
    attemptsLimit: lastAttemptsLimit,
  };
}

async function getCourses(
  page: Page,
  envBaseUrl: string,
  userId: string,
): Promise<Array<{ lectureSeq: number; title: string }>> {
  await page.goto(`${envBaseUrl}/el/member/mycourse_list_form.acl`, { waitUntil: "domcontentloaded" });
  const rawCourses = parseMyCourseHtml(await page.content(), userId, "ACTIVE");
  const now = Date.now();
  const courses = rawCourses.filter((course) => {
    if (course.progressPercent >= 100) return false;
    if (course.remainDays !== null && course.remainDays <= 0) return false;

    if (!course.periodEnd) return true;
    const periodEndMs = Date.parse(course.periodEnd);
    if (!Number.isFinite(periodEndMs)) return true;

    const periodEndAt = new Date(periodEndMs);
    periodEndAt.setHours(23, 59, 59, 999);
    return periodEndAt.getTime() >= now;
  });

  return courses.map((course) => ({
    lectureSeq: course.lectureSeq,
    title: course.title,
  }));
}

function toAutoLearnPlannedTask(row: PlannedTask): AutoLearnPlannedTask {
  return {
    lectureSeq: row.lectureSeq,
    courseContentsSeq: row.task.courseContentsSeq,
    courseTitle: row.courseTitle,
    weekNo: row.task.weekNo,
    lessonNo: row.task.lessonNo,
    taskTitle: row.task.taskTitle ?? `차시 ${row.task.weekNo}-${row.task.lessonNo}`,
    state: row.task.state,
    activityType: row.task.activityType,
    requiredSeconds: row.task.requiredSeconds,
    learnedSeconds: row.task.learnedSeconds,
    availableFrom: row.task.availableFrom ?? null,
    dueAt: row.task.dueAt ?? null,
    remainingSeconds: row.remainingSeconds,
  };
}

async function planTasks(
  page: Page,
  envBaseUrl: string,
  userId: string,
  mode: AutoLearnMode,
  lectureSeq?: number,
): Promise<PlanResult> {
  const courses = await getCourses(page, envBaseUrl, userId);
  const courseTitleBySeq = new Map(courses.map((course) => [course.lectureSeq, course.title]));
  if (mode === "ALL_COURSES" && courses.length === 0) {
    return { planned: [], noOpReason: "NO_ACTIVE_COURSES" };
  }

  const lectureSeqs =
    mode === "ALL_COURSES"
      ? courses.map((course) => course.lectureSeq)
      : lectureSeq
        ? [lectureSeq]
        : [];
  if (mode !== "ALL_COURSES" && lectureSeqs.length === 0) {
    return { planned: [], noOpReason: "LECTURE_NOT_FOUND" };
  }
  if (mode !== "ALL_COURSES" && lectureSeq && !courseTitleBySeq.has(lectureSeq)) {
    return { planned: [], noOpReason: "LECTURE_NOT_FOUND" };
  }
  const tasksByLecture = new Map<number, LearningTask[]>();

  for (const seq of lectureSeqs) {
    const tasks = await fetchLectureTasks(page, envBaseUrl, userId, seq);
    tasksByLecture.set(seq, tasks);
  }

  return buildTaskPlan({
    mode,
    lectureSeqs,
    lectureSeq,
    courseTitleBySeq,
    tasksByLecture,
  });
}

export async function runAutoLearning(
  browser: Browser,
  userId: string,
  creds: Cu12Credentials,
  options: {
    mode: AutoLearnMode;
    lectureSeq?: number;
  },
  onProgress?: (progress: AutoLearnProgress) => Promise<void> | void,
  onCancelCheck?: CancelCheck,
): Promise<AutoLearnResult> {
  const env = getEnv();
  const context = await browser.newContext(createRealisticBrowserContextOptions());
  const page = await context.newPage();
  installDialogHandler(page);
  await installEvaluateCompatShim(page);
  const shouldCancel = onCancelCheck ?? (async () => false);

  try {
    await ensureLogin(page, creds);

    const mode = options.mode;
    const heartbeatIntervalSeconds = Math.max(10, env.AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS);
    const { planned: plannedAll, noOpReason } = await planTasks(page, env.CU12_BASE_URL, userId, mode, options.lectureSeq);
    const chunk = selectChunkTasks(plannedAll, env);
    const planned = chunk.planned;
    const truncated = chunk.truncated;
    const plannedPreview = planned.map(toAutoLearnPlannedTask);
    const estimatedTotalSeconds = chunk.estimatedTotalSeconds;

    if (onProgress) {
      await onProgress({
        phase: "PLANNING",
        mode,
        totalTasks: planned.length,
        completedTasks: 0,
        elapsedSeconds: 0,
        estimatedRemainingSeconds: estimatedTotalSeconds,
        noOpReason,
        plannedTaskCount: planned.length,
        planned: plannedPreview,
        truncated,
        heartbeatAt: new Date().toISOString(),
      });
    }

    let processedTaskCount = 0;
    let elapsedSecondsTotal = 0;

    for (const row of planned) {
      if (await shouldCancel()) {
        throw new Error("AUTOLEARN_CANCELLED");
      }

      const plannedTaskSeconds = row.task.activityType === "VOD"
        ? Math.ceil(row.remainingSeconds * env.AUTOLEARN_TIME_FACTOR)
        : 0;
      if (onProgress) {
        const consumed = elapsedSecondsTotal;
        await onProgress({
          phase: "RUNNING",
          mode,
          totalTasks: planned.length,
          completedTasks: processedTaskCount,
          elapsedSeconds: elapsedSecondsTotal,
          estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - consumed),
          noOpReason,
          plannedTaskCount: planned.length,
          planned: plannedPreview,
          truncated,
          heartbeatAt: new Date().toISOString(),
          current: {
            lectureSeq: row.lectureSeq,
            weekNo: row.task.weekNo,
            lessonNo: row.task.lessonNo,
            activityType: row.task.activityType,
            remainingSeconds: plannedTaskSeconds,
            elapsedSeconds: 0,
            courseTitle: row.courseTitle,
            taskTitle: row.task.taskTitle,
          },
        });
      }

      if (env.AUTOLEARN_HUMANIZATION_ENABLED) {
        await humanPause(page, env.AUTOLEARN_DELAY_MIN_MS, env.AUTOLEARN_DELAY_MAX_MS, shouldCancel);
      }

      let execution: TaskExecutionResult;

      if (row.task.activityType === "VOD") {
        let lastReportedElapsedSeconds = 0;
        const elapsedForTask = await watchVodTask(
          page,
          row.lectureSeq,
          row.task,
          shouldCancel,
          async ({ elapsedSeconds, remainingSeconds }) => {
            if (!onProgress) return;
            if (remainingSeconds > 0 && elapsedSeconds % heartbeatIntervalSeconds !== 0) return;
            if (elapsedSeconds <= lastReportedElapsedSeconds && remainingSeconds > 0) return;

            lastReportedElapsedSeconds = elapsedSeconds;
            const consumed = elapsedSecondsTotal + elapsedSeconds;
            await onProgress({
              phase: "RUNNING",
              mode,
              totalTasks: planned.length,
              completedTasks: processedTaskCount,
              elapsedSeconds: consumed,
              estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - consumed),
              noOpReason,
              plannedTaskCount: planned.length,
              planned: plannedPreview,
              truncated,
              heartbeatAt: new Date().toISOString(),
              current: {
                lectureSeq: row.lectureSeq,
                weekNo: row.task.weekNo,
                lessonNo: row.task.lessonNo,
                activityType: row.task.activityType,
                remainingSeconds,
                elapsedSeconds,
                courseTitle: row.courseTitle,
                taskTitle: row.task.taskTitle,
              },
            });
          },
        );
        execution = {
          activityType: "VOD",
          elapsedSeconds: elapsedForTask,
        };
      } else if (row.task.activityType === "MATERIAL") {
        execution = await completeMaterialTask(page, env.CU12_BASE_URL, userId, row, shouldCancel);
      } else if (row.task.activityType === "QUIZ") {
        execution = await completeQuizTask(
          page,
          env.CU12_BASE_URL,
          row,
          shouldCancel,
          async (question) => {
            if (!onProgress) return;
            await onProgress({
              phase: "RUNNING",
              mode,
              totalTasks: planned.length,
              completedTasks: processedTaskCount,
              elapsedSeconds: elapsedSecondsTotal,
              estimatedRemainingSeconds: Math.max(0, estimatedTotalSeconds - elapsedSecondsTotal),
              noOpReason,
              plannedTaskCount: planned.length,
              planned: plannedPreview,
              truncated,
              heartbeatAt: new Date().toISOString(),
              current: {
                lectureSeq: row.lectureSeq,
                weekNo: row.task.weekNo,
                lessonNo: row.task.lessonNo,
                activityType: row.task.activityType,
                remainingSeconds: 0,
                elapsedSeconds: 0,
                courseTitle: row.courseTitle,
                taskTitle: row.task.taskTitle,
                questionIndex: question.questionIndex,
                questionCount: question.questionCount,
                attemptsUsed: question.attemptsUsed,
                attemptsLimit: question.attemptsLimit,
              },
            });
          },
        );
      } else {
        throw new Error(`AUTOLEARN_UNSUPPORTED_ACTIVITY:${row.task.activityType}`);
      }

      processedTaskCount += 1;
      elapsedSecondsTotal += execution.elapsedSeconds;
    }

    if (onProgress) {
      await onProgress({
        phase: "DONE",
        mode,
        totalTasks: planned.length,
        completedTasks: processedTaskCount,
        elapsedSeconds: elapsedSecondsTotal,
        estimatedRemainingSeconds: 0,
        noOpReason,
        plannedTaskCount: planned.length,
        planned: plannedPreview,
        truncated,
        heartbeatAt: new Date().toISOString(),
      });
    }

    return {
      mode,
      processedTaskCount,
      elapsedSeconds: elapsedSecondsTotal,
      lectureSeqs: Array.from(new Set(planned.map((row) => row.lectureSeq))),
      plannedTaskCount: planned.length,
      truncated,
      noOpReason,
      planned: plannedPreview,
      estimatedTotalSeconds,
    };
  } finally {
    await context.close();
  }
}



