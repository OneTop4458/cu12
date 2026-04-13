import {
  parseCyberCampusSecondaryAuthMethods,
  parseCyberCampusTodoListHtml,
  type LearningTask,
} from "@cu12/core";
import { JobStatus, JobType, Prisma } from "@prisma/client";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Dialog, type Page } from "playwright";
import { interpretCyberCampusTaskAccessState } from "./cyber-campus-auth-state";
import type { ClaimedJob } from "./internal-api";
import { prisma } from "./prisma";
import { isCyberCampusAuthenticatedResponse } from "./cyber-campus-session-state";
import { getEnv } from "./env";
import { retryOnceAfterEmptyStoredSession } from "./cyber-campus-session-recovery";
import {
  failBlockedAutoLearnJob,
  getPortalApprovalSessionState,
  getUserCu12Credentials,
  markAccountNeedsReauth,
  succeedBlockedAutoLearnJob,
  type PortalApprovalSecondaryAuthMethod,
  type PortalApprovalRuntimeState,
  type PortalSessionCookieState,
  updatePortalApprovalSessionStateForWorker,
  upsertPortalSessionCookieState,
} from "./sync-store";

type AutoLearnMode = "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";

interface AutoLearnJobRequest {
  mode: AutoLearnMode;
  lectureSeq: number | null;
}

interface SecondaryAuthJsonResponse {
  isError?: boolean;
  message?: string;
  messageCode?: string;
  [key: string]: unknown;
}

interface TextResponse {
  url: string;
  status: number;
  contentType: string | null;
  text: string;
}

export interface CyberCampusApprovalAutoLearnContinuation {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  job: ClaimedJob;
}

interface ApprovalTaskContext {
  task: LearningTask;
  secondaryAuthBlocked: boolean;
  pageUrl: string;
}

interface ApprovalContextResolution {
  kind: "NO_PENDING_TASKS" | "NO_APPROVAL_REQUIRED" | "APPROVAL_REQUIRED";
  taskCount: number;
  context: ApprovalTaskContext | null;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/124.0.0.0 Safari/537.36";

function buildSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

function buildApprovalExpiry(now = new Date(), active = false): Date {
  return new Date(now.getTime() + (active ? 5 * 60 * 1000 : 10 * 60 * 1000));
}

function createBrowserContextOptions(): BrowserContextOptions {
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

function toExpiresAt(currentTime: unknown, expireTime: unknown): Date | null {
  const current = Number(currentTime);
  const expire = Number(expireTime);
  if (!Number.isFinite(expire)) return null;
  if (expire > 1_000_000_000_000) return new Date(expire);
  if (Number.isFinite(current) && current > 1_000_000_000_000 && expire > current) {
    return new Date(expire);
  }
  if (expire > 1_000_000_000) return new Date(expire * 1000);
  return null;
}

function toCookieState(cookies: Array<{ name: string; value: string }>): PortalSessionCookieState[] {
  return cookies.map((cookie) => ({ name: cookie.name, value: cookie.value }));
}

function isReauthRequiredMessage(message: string): boolean {
  return message.includes("사이버캠퍼스 로그인에 실패했습니다")
    || message.includes("사이버캠퍼스 세션이 만료되었습니다");
}

function parseDateMsOrNull(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinCyberCampusLearningWindow(task: LearningTask, nowMs: number): boolean {
  const availableFromMs = parseDateMsOrNull(task.availableFrom);
  if (availableFromMs !== null && nowMs < availableFromMs) return false;

  const dueAtMs = parseDateMsOrNull(task.dueAt);
  if (dueAtMs !== null && nowMs > dueAtMs) return false;

  return true;
}

function sortCyberCampusTasks<T extends { weekNo: number; lessonNo: number }>(tasks: T[]): T[] {
  return tasks
    .slice()
    .sort((a, b) => (a.weekNo - b.weekNo) || (a.lessonNo - b.lessonNo));
}

export function selectCyberCampusApprovalProbeTasks(
  tasks: LearningTask[],
  request: AutoLearnJobRequest,
  nowMs = Date.now(),
): LearningTask[] {
  const filtered = sortCyberCampusTasks(
    tasks.filter((task) =>
      task.activityType === "VOD"
      && task.state === "PENDING"
      && typeof task.externalLectureId === "string"
      && task.externalLectureId.trim().length > 0
      && isWithinCyberCampusLearningWindow(task, nowMs),
    ),
  );

  const targeted = request.mode === "ALL_COURSES"
    ? filtered
    : filtered.filter((task) => task.lectureSeq === request.lectureSeq);

  return request.mode === "SINGLE_NEXT"
    ? targeted.slice(0, 1)
    : targeted;
}

export function shouldResumeBlockedAutoLearnForApprovalContext(
  kind: ApprovalContextResolution["kind"],
): boolean {
  return kind !== "NO_PENDING_TASKS";
}

export function buildCyberCampusApprovalNoPendingAutoLearnResult(request: AutoLearnJobRequest) {
  return {
    type: "AUTOLEARN" as const,
    mode: request.mode,
    processedTaskCount: 0,
    elapsedSeconds: 0,
    lectureSeqs: [],
    plannedTaskCount: 0,
    truncated: false,
    estimatedTotalSeconds: 0,
    noOpReason: "NO_PENDING_TASKS" as const,
    planned: [],
  };
}

async function applyCookieState(page: Page, cookieState: PortalSessionCookieState[]) {
  if (!cookieState.length) return;
  await page.context().addCookies(
    cookieState.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: getEnv().CYBER_CAMPUS_BASE_URL,
    })),
  );
}

async function exportCookieState(page: Page): Promise<PortalSessionCookieState[]> {
  const cookies = await page.context().cookies(getEnv().CYBER_CAMPUS_BASE_URL);
  return toCookieState(cookies);
}

async function postFormText(
  page: Page,
  path: string,
  form: Record<string, string>,
): Promise<TextResponse> {
  const url = new URL(path, getEnv().CYBER_CAMPUS_BASE_URL).toString();
  return page.evaluate(async ({ inputUrl, inputForm }) => {
    const response = await fetch(inputUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams(inputForm).toString(),
      credentials: "include",
    });

    return {
      url: response.url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
    };
  }, {
    inputUrl: url,
    inputForm: form,
  });
}

function parseJsonResponse<T>(response: TextResponse, label: string): T {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    if (response.text.includes("접속이 종료 되었습니다")) {
      throw new Error("사이버캠퍼스 세션이 만료되었습니다. 다시 로그인해 주세요.");
    }
    if (response.text.includes("접근 권한이 없습니다")) {
      throw new Error("사이버캠퍼스 학습 컨텍스트를 열지 못했습니다.");
    }
    throw new Error(`사이버캠퍼스 ${label} 응답을 해석하지 못했습니다.`);
  }
}

async function ensureSession(
  page: Page,
  cookieState: PortalSessionCookieState[],
  creds: { cu12Id: string; cu12Password: string },
) {
  await applyCookieState(page, cookieState);
  await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/main_form.acl`, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  if (isCyberCampusAuthenticatedResponse(html, page.url())) {
    return;
  }

  await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/member/login_form.acl`, { waitUntil: "domcontentloaded" });
  if (isCyberCampusAuthenticatedResponse(await page.content(), page.url())) {
    return;
  }
  await page.fill("#usr_id", creds.cu12Id);
  await page.fill("#usr_pwd", creds.cu12Password);
  await page.click("#login_btn");

  try {
    await page.waitForURL(/\/ilos\/main\/main_form\.acl/, { timeout: 20_000 });
  } catch {
    throw new Error("사이버캠퍼스 로그인에 실패했습니다. 계정 연결 상태를 확인한 뒤 다시 시도해 주세요.");
  }
}

async function forceFreshLogin(
  page: Page,
  creds: { cu12Id: string; cu12Password: string },
) {
  await page.context().clearCookies();
  await ensureSession(page, [], creds);
}

async function resolveApprovalJobRequest(jobId: string, userId: string): Promise<AutoLearnJobRequest> {
  const row = await prisma.jobQueue.findFirst({
    where: {
      id: jobId,
      userId,
      type: "AUTOLEARN",
    },
    select: {
      payload: true,
    },
  });

  const payload =
    row?.payload
    && typeof row.payload === "object"
    && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown>
      : null;
  const autoLearnMode =
    payload
    && "autoLearnMode" in payload
    && (payload.autoLearnMode === "SINGLE_NEXT" || payload.autoLearnMode === "SINGLE_ALL" || payload.autoLearnMode === "ALL_COURSES")
      ? payload.autoLearnMode
      : "ALL_COURSES";
  const lectureSeq =
    payload
    && "lectureSeq" in payload
    && typeof payload.lectureSeq === "number"
    && Number.isFinite(payload.lectureSeq)
      ? payload.lectureSeq
      : null;

  return {
    mode: autoLearnMode,
    lectureSeq,
  };
}

async function loadProbeTasks(
  page: Page,
  userId: string,
  request: AutoLearnJobRequest,
): Promise<LearningTask[]> {
  const todoResponse = await postFormText(page, "/ilos/mp/todo_list.acl", {
    todoKjList: "",
    chk_cate: "ALL",
    encoding: "utf-8",
  });

  if (todoResponse.status >= 400) {
    throw new Error("사이버캠퍼스 학습 목록을 불러오지 못했습니다.");
  }

  const tasks = parseCyberCampusTodoListHtml(todoResponse.text, userId);
  return selectCyberCampusApprovalProbeTasks(tasks, request);
}

async function withSecondaryAuthDialogTracking(
  page: Page,
  action: () => Promise<void>,
): Promise<boolean> {
  let secondaryAuthBlocked = false;
  const onDialog = async (dialog: Dialog) => {
    if (dialog.message().includes("본인인증")) {
      secondaryAuthBlocked = true;
    }
    await dialog.accept();
  };

  page.on("dialog", onDialog);
  try {
    await action();
  } finally {
    page.off("dialog", onDialog);
  }

  return secondaryAuthBlocked;
}

async function enterTaskContext(page: Page, task: LearningTask): Promise<ApprovalTaskContext> {
  const externalLectureId = task.externalLectureId?.trim();
  if (!externalLectureId) {
    throw new Error("사이버캠퍼스 자동 수강 대상 강의 정보를 찾지 못했습니다.");
  }

  const baseUrl = getEnv().CYBER_CAMPUS_BASE_URL;
  const secondaryAuthBlocked = await withSecondaryAuthDialogTracking(page, async () => {
    await page.goto(
      `${baseUrl}/ilos/mp/todo_list_connect.acl?SEQ=${task.courseContentsSeq}&gubun=lecture_weeks&KJKEY=${encodeURIComponent(externalLectureId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForTimeout(2000);
    await page.evaluate(
      ({ weekNo, lessonSeq }) => {
        const form = document.forms.namedItem("myform") as HTMLFormElement | null;
        if (!form) return;
        const lectureWeeks = form.querySelector<HTMLInputElement>('input[name="lecture_weeks"]');
        const weekNoInput = form.querySelector<HTMLInputElement>('input[name="WEEK_NO"]');
        const itemIdInput = form.querySelector<HTMLInputElement>('input[name="item_id"]');
        if (lectureWeeks) lectureWeeks.value = String(lessonSeq);
        if (weekNoInput) weekNoInput.value = String(weekNo);
        if (itemIdInput) itemIdInput.value = "";
        form.submit();
      },
      { weekNo: task.weekNo, lessonSeq: task.courseContentsSeq },
    );
    await page.waitForTimeout(3000);
  });

  return {
    task,
    secondaryAuthBlocked,
    pageUrl: page.url(),
  };
}

async function checkSecondaryAuth(page: Page) {
  const response = await postFormText(page, "/ilos/secondauth/session_secondary_auth_check.acl", {
    returnData: "json",
    AUTH_DIV: "1",
    encoding: "utf-8",
  });
  const data = parseJsonResponse<SecondaryAuthJsonResponse>(response, "2차 인증 상태 확인");
  return {
    ready: !data.isError,
    message: typeof data.message === "string" ? data.message : null,
    messageCode: typeof data.messageCode === "string" ? data.messageCode : null,
  };
}

async function loadSecondaryAuthMethods(page: Page) {
  const response = await postFormText(page, "/ilos/secondauth/secondary_auth_way_info.acl", {
    AUTH_DIV: "1",
    returnData: "json",
    encoding: "utf-8",
  });
  const data = parseJsonResponse<SecondaryAuthJsonResponse>(response, "2차 인증 수단 조회");
  if (data.isError) {
    throw new Error(typeof data.message === "string" ? data.message : "사이버캠퍼스 인증 수단을 불러오지 못했습니다.");
  }

  const methods = parseCyberCampusSecondaryAuthMethods(data);
  if (methods.length === 0) {
    throw new Error("사용 가능한 사이버캠퍼스 인증 수단을 찾지 못했습니다.");
  }

  return methods as PortalApprovalSecondaryAuthMethod[];
}

async function startSecondaryAuth(
  page: Page,
  method: PortalApprovalSecondaryAuthMethod,
) {
  const response = await postFormText(page, "/ilos/secondauth/secondary_auth_start.acl", {
    AUTH_DIV: "1",
    AUTH_WAY: String(method.way),
    AUTH_PARAM: method.param,
    returnData: "json",
    encoding: "utf-8",
  });
  const data = parseJsonResponse<SecondaryAuthJsonResponse>(response, "2차 인증 시작");
  if (data.isError) {
    throw new Error(typeof data.message === "string" ? data.message : "사이버캠퍼스 인증 요청을 시작하지 못했습니다.");
  }

  return {
    authSeq: String(data.AUTH_SEQ ?? ""),
    requestCode: typeof data.REQUEST_CODE === "string" ? data.REQUEST_CODE : null,
    displayCode: typeof data.AUTH_CODE === "string" ? data.AUTH_CODE : null,
    expiresAt: toExpiresAt(data.CURRENT_TIME, data.EXPIRE_TIME),
  };
}

async function confirmSecondaryAuth(
  page: Page,
  input: {
    authSeq: string;
    method: PortalApprovalSecondaryAuthMethod;
    code: string | null;
  },
) {
  const response = await postFormText(page, "/ilos/secondauth/secondary_auth_confirm.acl", {
    AUTH_SEQ: input.authSeq,
    AUTH_DIV: "1",
    AUTH_WAY: String(input.method.way),
    AUTH_CODE: input.code ?? "",
    AUTH_PARAM: input.method.param,
    returnData: "json",
    encoding: "utf-8",
  });
  const data = parseJsonResponse<SecondaryAuthJsonResponse>(response, "2차 인증 확인");

  if (data.isError) {
    return {
      completed: false,
      pending: typeof data.messageCode === "string" && data.messageCode === "E_CONFIRMED_SECONDARY_AUTH",
      message: typeof data.message === "string" ? data.message : null,
      messageCode: typeof data.messageCode === "string" ? data.messageCode : null,
    };
  }

  return {
    completed: true,
    pending: false,
    message: null,
    messageCode: null,
  };
}

const CYBER_CAMPUS_APPROVAL_WORKER_POLL_MS = 2_000;
const CYBER_CAMPUS_APPROVAL_WORKER_HEARTBEAT_MS = 5_000;

function isExpectedApprovalRequirement(input: {
  checkMessageCode: string | null;
  checkMessage: string | null;
  secondaryAuthBlocked: boolean;
  pageUrl: string;
}): boolean {
  if (input.secondaryAuthBlocked) return true;
  if (/\/ilos\/st\/course\/submain_form\.acl/i.test(input.pageUrl)) return true;
  if (input.checkMessageCode === "E_CONFIRMED_SECONDARY_AUTH") return true;
  return Boolean(input.checkMessage?.includes("본인인증"));
}

function getApprovalTaskAccessState(input: {
  ready: boolean;
  messageCode: string | null;
  message: string | null;
  secondaryAuthBlocked: boolean;
  pageUrl: string;
}) {
  return interpretCyberCampusTaskAccessState({
    ready: input.ready,
    messageCode: input.messageCode,
    message: input.message,
    secondaryAuthBlocked: input.secondaryAuthBlocked,
    pageUrl: input.pageUrl,
  });
}

async function resolveApprovalContext(
  page: Page,
  userId: string,
  request: AutoLearnJobRequest,
  options?: {
    hasStoredSession?: boolean;
    refreshSession?: () => Promise<void>;
  },
): Promise<ApprovalContextResolution> {
  const retryResult = await retryOnceAfterEmptyStoredSession({
    hasStoredSession: Boolean(options?.hasStoredSession),
    load: () => loadProbeTasks(page, userId, request),
    isEmpty: (tasks) => tasks.length === 0,
    refresh: async () => {
      await options?.refreshSession?.();
    },
  });
  const tasks = retryResult.result;
  if (retryResult.retriedStoredSession && tasks.length > 0) {
    console.warn("[CYBER_CAMPUS] recovered empty approval probe task list after refreshing stored session");
  }
  if (tasks.length === 0) {
    return {
      kind: "NO_PENDING_TASKS",
      taskCount: 0,
      context: null,
    };
  }

  for (const task of tasks) {
    const context = await enterTaskContext(page, task);
    const check = await checkSecondaryAuth(page);
    const accessState = getApprovalTaskAccessState({
      ready: check.ready,
      messageCode: check.messageCode,
      message: check.message,
      secondaryAuthBlocked: context.secondaryAuthBlocked,
      pageUrl: context.pageUrl,
    });
    if (accessState === "READY") {
      continue;
    }

    if (accessState === "SECONDARY_AUTH_REQUIRED") {
      return {
        kind: "APPROVAL_REQUIRED",
        taskCount: tasks.length,
        context,
      };
    }

    throw new Error(check.message ?? "사이버캠퍼스 인증 필요 여부를 확인하지 못했습니다.");
  }

  return {
    kind: "NO_APPROVAL_REQUIRED",
    taskCount: tasks.length,
    context: null,
  };
}

async function waitForConfirmedTaskAccess(page: Page, context: ApprovalTaskContext) {
  const settleDelaysMs = [0, 1_500, 3_000, 5_000];

  for (const delayMs of settleDelaysMs) {
    if (delayMs > 0) {
      await page.waitForTimeout(delayMs);
    }

    const refreshedContext = await enterTaskContext(page, context.task);
    const check = await checkSecondaryAuth(page);
    const accessState = getApprovalTaskAccessState({
      ready: check.ready,
      messageCode: check.messageCode,
      message: check.message,
      secondaryAuthBlocked: refreshedContext.secondaryAuthBlocked,
      pageUrl: refreshedContext.pageUrl,
    });
    if (accessState === "READY") {
      return { verified: true as const };
    }

    if (accessState === "ERROR") {
      throw new Error(check.message ?? "CYBER_CAMPUS_TASK_ACCESS_CHECK_FAILED");
    }
  }

  return { verified: false as const };
}

function createApprovalLeaseManager(input: {
  approvalId: string;
  userId: string;
  workerId: string;
  initialRuntimeState: PortalApprovalRuntimeState;
}) {
  let currentRuntimeState = input.initialRuntimeState;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let updateChain: Promise<void> = Promise.resolve();

  const pushHeartbeat = (runtimeState = currentRuntimeState) => {
    currentRuntimeState = runtimeState;
    if (stopped) return updateChain;
    updateChain = updateChain
      .catch(() => {})
      .then(async () => {
        if (stopped) return;
        await updatePortalApprovalSessionStateForWorker({
          approvalId: input.approvalId,
          userId: input.userId,
          runtimeState: currentRuntimeState,
          workerLeaseId: input.workerId,
          workerHeartbeatAt: new Date(),
        });
      });
    return updateChain;
  };

  return {
    setRuntimeState(runtimeState: PortalApprovalRuntimeState) {
      currentRuntimeState = runtimeState;
    },
    async start() {
      await pushHeartbeat(currentRuntimeState);
      timer = setInterval(() => {
        void pushHeartbeat();
      }, CYBER_CAMPUS_APPROVAL_WORKER_HEARTBEAT_MS);
    },
    async sync(runtimeState?: PortalApprovalRuntimeState) {
      await pushHeartbeat(runtimeState ?? currentRuntimeState);
    },
    async stop() {
      if (stopped) {
        await updateChain.catch(() => {});
        return;
      }
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await updateChain.catch(() => {});
    },
  };
}

async function claimBlockedAutoLearnContinuationJob(input: {
  jobId: string;
  userId: string;
  workerId: string;
}): Promise<ClaimedJob> {
  const startedAt = new Date();
  const claimed = await prisma.jobQueue.updateMany({
    where: {
      id: input.jobId,
      userId: input.userId,
      type: JobType.AUTOLEARN,
      status: JobStatus.BLOCKED,
    },
    data: {
      status: JobStatus.RUNNING,
      startedAt,
      attempts: { increment: 1 },
      workerId: input.workerId,
      runAfter: startedAt,
      finishedAt: null,
      lastError: null,
      result: Prisma.DbNull,
    },
  });
  if (claimed.count === 0) {
    throw new Error(`CYBER_CAMPUS_AUTOLEARN_CONTINUATION_CLAIM_FAILED:${input.jobId}`);
  }

  const job = await prisma.jobQueue.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      attempts: true,
      workerId: true,
    },
  });
  if (
    !job
    || job.type !== JobType.AUTOLEARN
    || job.status !== JobStatus.RUNNING
    || job.workerId !== input.workerId
  ) {
    throw new Error(`CYBER_CAMPUS_AUTOLEARN_CONTINUATION_NOT_RUNNING:${input.jobId}`);
  }

  return {
    id: job.id,
    type: job.type,
    payload: job.payload as ClaimedJob["payload"],
    attempts: job.attempts,
  };
}

async function completeApproval(input: {
  approvalId: string;
  userId: string;
  page: Page;
}) {
  const cookieState = await exportCookieState(input.page);
  await upsertPortalSessionCookieState({
    userId: input.userId,
    provider: "CYBER_CAMPUS",
    cookieState,
    expiresAt: buildSessionExpiry(),
    status: "ACTIVE",
  });
  await updatePortalApprovalSessionStateForWorker({
    approvalId: input.approvalId,
    userId: input.userId,
    status: "COMPLETED",
    runtimeState: "COMPLETED",
    cookieState,
    requestedAction: null,
    pendingCode: null,
    errorMessage: null,
    workerLeaseId: null,
    workerHeartbeatAt: null,
    restartRequired: false,
    completedAt: new Date(),
    expiresAt: buildApprovalExpiry(new Date(), true),
  });
}

async function failApprovalAction(input: {
  approvalId: string;
  userId: string;
  message: string;
  page?: Page;
}) {
  await updatePortalApprovalSessionStateForWorker({
    approvalId: input.approvalId,
    userId: input.userId,
    runtimeState: "FAILED",
    cookieState: input.page ? await exportCookieState(input.page) : undefined,
    requestedAction: null,
    pendingCode: null,
    errorMessage: input.message,
    workerLeaseId: null,
    workerHeartbeatAt: null,
    expiresAt: buildApprovalExpiry(new Date(), true),
  });
}

function isTerminalApprovalStatus(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELED" || status === "EXPIRED";
}

async function expireApprovalSession(input: {
  approvalId: string;
  userId: string;
  jobId: string;
}) {
  await updatePortalApprovalSessionStateForWorker({
    approvalId: input.approvalId,
    userId: input.userId,
    status: "EXPIRED",
    runtimeState: "FAILED",
    requestedAction: null,
    pendingCode: null,
    workerLeaseId: null,
    workerHeartbeatAt: null,
  });
  await failBlockedAutoLearnJob(input.jobId, input.userId, "SECONDARY_AUTH_TIMEOUT");
}

async function waitForApprovalState(
  approvalId: string,
  input: {
    workerId: string;
    runtimeState: PortalApprovalRuntimeState;
    userId: string;
    waitForCode: boolean;
  },
) {
  let heartbeatAt = 0;

  while (true) {
    const now = Date.now();
    if (heartbeatAt === 0 || now - heartbeatAt >= CYBER_CAMPUS_APPROVAL_WORKER_HEARTBEAT_MS) {
      await updatePortalApprovalSessionStateForWorker({
        approvalId,
        userId: input.userId,
        runtimeState: input.runtimeState,
        workerLeaseId: input.workerId,
        workerHeartbeatAt: new Date(now),
      });
      heartbeatAt = now;
    }

    const approval = await getPortalApprovalSessionState(approvalId);
    if (!approval) {
      throw new Error(`Cyber Campus approval session not found: ${approvalId}`);
    }
    if (isTerminalApprovalStatus(approval.status)) {
      return approval;
    }
    if (approval.expiresAt.getTime() <= Date.now()) {
      await expireApprovalSession({
        approvalId,
        userId: approval.userId,
        jobId: approval.jobId,
      });
      const expired = await getPortalApprovalSessionState(approvalId);
      if (!expired) {
        throw new Error(`Cyber Campus approval session not found: ${approvalId}`);
      }
      return expired;
    }

    if (approval.requestedAction === "START") {
      return approval;
    }
    if (approval.requestedAction === "CONFIRM" && (!input.waitForCode || approval.pendingCode)) {
      return approval;
    }

    await new Promise((resolve) => setTimeout(resolve, CYBER_CAMPUS_APPROVAL_WORKER_POLL_MS));
  }
}

export async function processCyberCampusApproval(
  approvalId: string,
  workerId = `worker-${process.pid}`,
) {
  const initialApproval = await getPortalApprovalSessionState(approvalId);
  if (!initialApproval) {
    throw new Error(`Cyber Campus approval session not found: ${approvalId}`);
  }
  let approval = initialApproval;
  if (isTerminalApprovalStatus(approval.status)) {
    return { type: "CYBER_CAMPUS_APPROVAL", state: approval.status, approvalId };
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    await expireApprovalSession({
      approvalId,
      userId: approval.userId,
      jobId: approval.jobId,
    });
    return { type: "CYBER_CAMPUS_APPROVAL", state: "EXPIRED", approvalId };
  }

  const creds = await getUserCu12Credentials(approval.userId);
  if (!creds) {
    await failApprovalAction({
      approvalId,
      userId: approval.userId,
      message: "사이버캠퍼스 계정이 연결되어 있지 않습니다.",
    });
    await failBlockedAutoLearnJob(approval.jobId, approval.userId, "ACCOUNT_NOT_CONNECTED");
    return { type: "CYBER_CAMPUS_APPROVAL", state: "FAILED", approvalId };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(createBrowserContextOptions());
  const page = await context.newPage();
  let continuation: CyberCampusApprovalAutoLearnContinuation | null = null;
  const approvalLease = createApprovalLeaseManager({
    approvalId,
    userId: approval.userId,
    workerId,
    initialRuntimeState: "BOOTSTRAPPING",
  });

  try {
    await approvalLease.start();

    await ensureSession(page, approval.cookieState, {
      cu12Id: creds.cu12Id,
      cu12Password: creds.cu12Password,
    });

    const jobRequest = await resolveApprovalJobRequest(approval.jobId, approval.userId);
    const contextResult = await resolveApprovalContext(page, approval.userId, jobRequest, {
      hasStoredSession: approval.cookieState.length > 0,
      refreshSession: async () => {
        await forceFreshLogin(page, {
          cu12Id: creds.cu12Id,
          cu12Password: creds.cu12Password,
        });
      },
    });

    if (contextResult.kind !== "APPROVAL_REQUIRED") {
      await approvalLease.stop();
      await completeApproval({
        approvalId,
        userId: approval.userId,
        page,
      });
      if (shouldResumeBlockedAutoLearnForApprovalContext(contextResult.kind)) {
        continuation = {
          browser,
          context,
          page,
          job: await claimBlockedAutoLearnContinuationJob({
            jobId: approval.jobId,
            userId: approval.userId,
            workerId,
          }),
        };
      } else {
        await succeedBlockedAutoLearnJob(
          approval.jobId,
          approval.userId,
          buildCyberCampusApprovalNoPendingAutoLearnResult(jobRequest),
        );
      }
      return {
        type: "CYBER_CAMPUS_APPROVAL",
        state: contextResult.kind === "NO_PENDING_TASKS" ? "NO_PENDING_TASKS" : "COMPLETED",
        approvalId,
        continuation,
      };
    }

    approval = await getPortalApprovalSessionState(approvalId) ?? approval;
    const methods = approval.methods.length > 0
      ? approval.methods
      : await loadSecondaryAuthMethods(page);
    const runtimeState: PortalApprovalRuntimeState =
      approval.requestedAction === "START"
        ? "STARTING_METHOD"
        : approval.requestedAction === "CONFIRM"
          ? "CONFIRMING"
          : "WAITING_METHOD";
    approvalLease.setRuntimeState(runtimeState);

    await updatePortalApprovalSessionStateForWorker({
      approvalId,
      userId: approval.userId,
      status: approval.authSeq ? "ACTIVE" : "PENDING",
      runtimeState,
      cookieState: await exportCookieState(page),
      methods,
      requestedAction: approval.requestedAction === "BOOTSTRAP" ? null : approval.requestedAction,
      pendingCode: approval.pendingCode ?? null,
      selectedWay: approval.selectedWay ?? null,
      selectedParam: approval.selectedParam ?? null,
      selectedTarget: approval.selectedTarget ?? null,
      authSeq: approval.authSeq ?? null,
      requestCode: approval.requestCode ?? null,
      displayCode: approval.displayCode ?? null,
      errorMessage: null,
      workerLeaseId: workerId,
      workerHeartbeatAt: new Date(),
      restartRequired: false,
      expiresAt: approval.authSeq ? buildApprovalExpiry(new Date(), true) : buildApprovalExpiry(),
      completedAt: null,
      canceledAt: null,
    });

    while (true) {
      approval = await getPortalApprovalSessionState(approvalId) ?? approval;
      if (isTerminalApprovalStatus(approval.status)) {
        return { type: "CYBER_CAMPUS_APPROVAL", state: approval.status, approvalId };
      }
      if (approval.expiresAt.getTime() <= Date.now()) {
        await approvalLease.stop();
        await expireApprovalSession({
          approvalId,
          userId: approval.userId,
          jobId: approval.jobId,
        });
        return { type: "CYBER_CAMPUS_APPROVAL", state: "EXPIRED", approvalId };
      }

      const method = approval.methods.find((item) => (
        item.way === approval.selectedWay
        && item.param === (approval.selectedParam ?? "")
      ));

      if (approval.requestedAction === "START") {
        if (!method) {
          throw new Error("?ъ씠踰꾩틺?쇱뒪 ?몄쬆 ?섎떒???ㅼ떆 ?좏깮??二쇱꽭??");
        }

        await approvalLease.sync("STARTING_METHOD");
        const started = await startSecondaryAuth(page, method);
        approvalLease.setRuntimeState("WAITING_CODE");
        await updatePortalApprovalSessionStateForWorker({
          approvalId,
          userId: approval.userId,
          status: "ACTIVE",
          runtimeState: "WAITING_CODE",
          cookieState: await exportCookieState(page),
          requestedAction: null,
          pendingCode: null,
          selectedWay: method.way,
          selectedParam: method.param,
          selectedTarget: method.target,
          authSeq: started.authSeq,
          requestCode: started.requestCode,
          displayCode: started.displayCode,
          errorMessage: null,
          workerLeaseId: workerId,
          workerHeartbeatAt: new Date(),
          restartRequired: false,
          expiresAt: started.expiresAt ?? buildApprovalExpiry(new Date(), true),
        });
        continue;
      }

      if (approval.requestedAction === "CONFIRM") {
        if (!method) {
          throw new Error("?ъ씠踰꾩틺?쇱뒪 ?몄쬆 ?섎떒???ㅼ떆 ?좏깮??二쇱꽭??");
        }
        if (method.requiresCode && !approval.pendingCode) {
          approvalLease.setRuntimeState("WAITING_CODE");
          await updatePortalApprovalSessionStateForWorker({
            approvalId,
            userId: approval.userId,
            status: "ACTIVE",
            runtimeState: "WAITING_CODE",
            cookieState: await exportCookieState(page),
            requestedAction: null,
            pendingCode: null,
            selectedWay: method.way,
            selectedParam: method.param,
            selectedTarget: method.target,
            authSeq: approval.authSeq ?? null,
            requestCode: approval.requestCode ?? null,
            displayCode: approval.displayCode ?? null,
            errorMessage: "?몄쬆 肄붾뱶瑜??낅젰?????ㅼ떆 ?쒕룄??二쇱꽭??",
            workerLeaseId: workerId,
            workerHeartbeatAt: new Date(),
            restartRequired: false,
            expiresAt: buildApprovalExpiry(new Date(), true),
          });
          continue;
        }

        let authSeq = approval.authSeq ?? "";
        let requestCode = approval.requestCode;
        let displayCode = approval.displayCode;

        if (!authSeq) {
          const started = await startSecondaryAuth(page, method);
          authSeq = started.authSeq;
          requestCode = started.requestCode;
          displayCode = started.displayCode;
        }

        await approvalLease.sync("CONFIRMING");
        const confirmation = await confirmSecondaryAuth(page, {
          authSeq,
          method,
          code: method.requiresCode ? approval.pendingCode : null,
        });

        if (!confirmation.completed) {
          approvalLease.setRuntimeState("WAITING_CODE");
          await updatePortalApprovalSessionStateForWorker({
            approvalId,
            userId: approval.userId,
            status: "ACTIVE",
            runtimeState: "WAITING_CODE",
            cookieState: await exportCookieState(page),
            requestedAction: null,
            pendingCode: null,
            selectedWay: method.way,
            selectedParam: method.param,
            selectedTarget: method.target,
            authSeq,
            requestCode,
            displayCode,
            errorMessage: confirmation.pending ? null : confirmation.message,
            workerLeaseId: workerId,
            workerHeartbeatAt: new Date(),
            restartRequired: false,
            expiresAt: buildApprovalExpiry(new Date(), true),
          });
          continue;
        }

        const approvalContext = contextResult.context;
        if (!approvalContext) {
          throw new Error("CYBER_CAMPUS_APPROVAL_CONTEXT_MISSING");
        }

        approvalLease.setRuntimeState("VERIFIED");
        await updatePortalApprovalSessionStateForWorker({
          approvalId,
          userId: approval.userId,
          status: "ACTIVE",
          runtimeState: "VERIFIED",
          cookieState: await exportCookieState(page),
          requestedAction: null,
          pendingCode: null,
          selectedWay: method.way,
          selectedParam: method.param,
          selectedTarget: method.target,
          authSeq,
          requestCode,
          displayCode,
          errorMessage: null,
          workerLeaseId: workerId,
          workerHeartbeatAt: new Date(),
          restartRequired: false,
          expiresAt: buildApprovalExpiry(new Date(), true),
        });

        const confirmedTaskAccess = await waitForConfirmedTaskAccess(page, approvalContext);
        if (!confirmedTaskAccess.verified) {
          approvalLease.setRuntimeState("WAITING_CODE");
          await updatePortalApprovalSessionStateForWorker({
            approvalId,
            userId: approval.userId,
            status: "ACTIVE",
            runtimeState: "WAITING_CODE",
            cookieState: await exportCookieState(page),
            requestedAction: null,
            pendingCode: null,
            selectedWay: method.way,
            selectedParam: method.param,
            selectedTarget: method.target,
            authSeq,
            requestCode,
            displayCode,
            errorMessage: null,
            workerLeaseId: workerId,
            workerHeartbeatAt: new Date(),
            restartRequired: false,
            expiresAt: buildApprovalExpiry(new Date(), true),
          });
          continue;
        }

        approvalLease.setRuntimeState("RESUMING_AUTOLEARN");
        await updatePortalApprovalSessionStateForWorker({
          approvalId,
          userId: approval.userId,
          status: "ACTIVE",
          runtimeState: "RESUMING_AUTOLEARN",
          cookieState: await exportCookieState(page),
          requestedAction: null,
          pendingCode: null,
          selectedWay: method.way,
          selectedParam: method.param,
          selectedTarget: method.target,
          authSeq,
          requestCode,
          displayCode,
          errorMessage: null,
          workerLeaseId: workerId,
          workerHeartbeatAt: new Date(),
          restartRequired: false,
          expiresAt: buildApprovalExpiry(new Date(), true),
        });

        await approvalLease.stop();
        await completeApproval({
          approvalId,
          userId: approval.userId,
          page,
        });
        continuation = {
          browser,
          context,
          page,
          job: await claimBlockedAutoLearnContinuationJob({
            jobId: approval.jobId,
            userId: approval.userId,
            workerId,
          }),
        };
        return { type: "CYBER_CAMPUS_APPROVAL", state: "COMPLETED", approvalId, continuation };
      }

      approvalLease.setRuntimeState(approval.authSeq ? "WAITING_CODE" : "WAITING_METHOD");
      approval = await waitForApprovalState(approvalId, {
        workerId,
        runtimeState: approval.authSeq ? "WAITING_CODE" : "WAITING_METHOD",
        userId: approval.userId,
        waitForCode: Boolean(method?.requiresCode),
      });
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isReauthRequiredMessage(message)) {
      await markAccountNeedsReauth(approval.userId, message);
    }
    await approvalLease.stop();
    await failApprovalAction({
      approvalId,
      userId: approval.userId,
      message,
      page,
    });
    if (isReauthRequiredMessage(message)) {
      await failBlockedAutoLearnJob(approval.jobId, approval.userId, "ACCOUNT_REAUTH_REQUIRED");
    }
    return {
      type: "CYBER_CAMPUS_APPROVAL",
      state: "FAILED",
      approvalId,
      message,
    };
  } finally {
    await approvalLease.stop();
    if (!continuation) {
      await context.close();
      await browser.close();
    }
  }
}
