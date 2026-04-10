import {
  parseCyberCampusSecondaryAuthMethods,
  parseCyberCampusTodoListHtml,
  type LearningTask,
} from "@cu12/core";
import { chromium, type Browser, type BrowserContext, type BrowserContextOptions, type Dialog, type Page } from "playwright";
import { prisma } from "./prisma";
import { getEnv } from "./env";
import { retryOnceAfterEmptyStoredSession } from "./cyber-campus-session-recovery";
import {
  failBlockedAutoLearnJob,
  getPortalApprovalSessionState,
  getUserCu12Credentials,
  markAccountNeedsReauth,
  reactivateBlockedAutoLearnJob,
  type PortalApprovalSecondaryAuthMethod,
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
  jobId: string;
  userId: string;
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

function looksAuthenticated(html: string, responseUrl: string): boolean {
  if (/\/ilos\/main\/main_form\.acl/i.test(responseUrl)) return true;
  return /\/ilos\/lo\/logout\.acl/i.test(html)
    || /popTodo\(/i.test(html)
    || /received_list_pop_form\.acl/i.test(html);
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
  if (cookieState.length) {
    await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/main_form.acl`, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    if (looksAuthenticated(html, page.url())) {
      return;
    }
  }

  await page.goto(`${getEnv().CYBER_CAMPUS_BASE_URL}/ilos/main/member/login_form.acl`, { waitUntil: "domcontentloaded" });
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
    if (check.ready) {
      continue;
    }

    if (isExpectedApprovalRequirement({
      checkMessageCode: check.messageCode,
      checkMessage: check.message,
      secondaryAuthBlocked: context.secondaryAuthBlocked,
      pageUrl: context.pageUrl,
    })) {
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
    if (check.ready) {
      return { verified: true as const };
    }

    if (!isExpectedApprovalRequirement({
      checkMessageCode: check.messageCode,
      checkMessage: check.message,
      secondaryAuthBlocked: refreshedContext.secondaryAuthBlocked,
      pageUrl: refreshedContext.pageUrl,
    })) {
      throw new Error(check.message ?? "CYBER_CAMPUS_TASK_ACCESS_CHECK_FAILED");
    }
  }

  return { verified: false as const };
}

async function completeApproval(input: {
  approvalId: string;
  userId: string;
  jobId: string;
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
    cookieState,
    requestedAction: null,
    pendingCode: null,
    errorMessage: null,
    completedAt: new Date(),
    expiresAt: buildApprovalExpiry(new Date(), true),
  });
  await reactivateBlockedAutoLearnJob(input.jobId, input.userId);
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
    cookieState: input.page ? await exportCookieState(input.page) : undefined,
    requestedAction: null,
    pendingCode: null,
    errorMessage: input.message,
    expiresAt: buildApprovalExpiry(new Date(), true),
  });
}

export async function processCyberCampusApproval(approvalId: string) {
  const approval = await getPortalApprovalSessionState(approvalId);
  if (!approval) {
    throw new Error(`Cyber Campus approval session not found: ${approvalId}`);
  }
  if (!approval.requestedAction) {
    return { type: "CYBER_CAMPUS_APPROVAL", state: "NO_ACTION", approvalId };
  }
  if (approval.status === "COMPLETED" || approval.status === "CANCELED" || approval.status === "EXPIRED") {
    return { type: "CYBER_CAMPUS_APPROVAL", state: approval.status, approvalId };
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    await updatePortalApprovalSessionStateForWorker({
      approvalId,
      userId: approval.userId,
      status: "EXPIRED",
      requestedAction: null,
      pendingCode: null,
    });
    await failBlockedAutoLearnJob(approval.jobId, approval.userId, "SECONDARY_AUTH_TIMEOUT");
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

  try {
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
      await completeApproval({
        approvalId,
        userId: approval.userId,
        jobId: approval.jobId,
        page,
      });
      if (contextResult.kind === "NO_APPROVAL_REQUIRED") {
        continuation = {
          browser,
          context,
          page,
          jobId: approval.jobId,
          userId: approval.userId,
        };
      }
      return {
        type: "CYBER_CAMPUS_APPROVAL",
        state: contextResult.kind === "NO_PENDING_TASKS" ? "NO_PENDING_TASKS" : "COMPLETED",
        approvalId,
        continuation,
      };
    }

    if (approval.requestedAction === "BOOTSTRAP") {
      const methods = await loadSecondaryAuthMethods(page);
      await updatePortalApprovalSessionStateForWorker({
        approvalId,
        userId: approval.userId,
        status: "PENDING",
        cookieState: await exportCookieState(page),
        methods,
        requestedAction: null,
        pendingCode: null,
        selectedWay: null,
        selectedParam: null,
        selectedTarget: null,
        authSeq: null,
        requestCode: null,
        displayCode: null,
        errorMessage: null,
        expiresAt: buildApprovalExpiry(),
        completedAt: null,
        canceledAt: null,
      });
      return { type: "CYBER_CAMPUS_APPROVAL", state: "READY", approvalId };
    }

    const method = approval.methods.find((item) => (
      item.way === approval.selectedWay
      && item.param === (approval.selectedParam ?? "")
    ));
    if (!method) {
      throw new Error("사이버캠퍼스 인증 수단을 다시 선택해 주세요.");
    }

    if (approval.requestedAction === "START") {
      const started = await startSecondaryAuth(page, method);
      await updatePortalApprovalSessionStateForWorker({
        approvalId,
        userId: approval.userId,
        status: "ACTIVE",
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
        expiresAt: started.expiresAt ?? buildApprovalExpiry(new Date(), true),
      });
      return { type: "CYBER_CAMPUS_APPROVAL", state: "ACTIVE", approvalId };
    }

    if (method.requiresCode && !approval.pendingCode) {
      throw new Error("인증 코드를 입력한 뒤 다시 시도해 주세요.");
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

    const confirmation = await confirmSecondaryAuth(page, {
      authSeq,
      method,
      code: method.requiresCode ? approval.pendingCode : null,
    });

    if (!confirmation.completed) {
      await updatePortalApprovalSessionStateForWorker({
        approvalId,
        userId: approval.userId,
        status: "ACTIVE",
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
        expiresAt: buildApprovalExpiry(new Date(), true),
      });
      return {
        type: "CYBER_CAMPUS_APPROVAL",
        state: confirmation.pending ? "PENDING" : "ACTIVE",
        approvalId,
      };
    }

    const approvalContext = contextResult.context;
    if (!approvalContext) {
      throw new Error("CYBER_CAMPUS_APPROVAL_CONTEXT_MISSING");
    }

    const confirmedTaskAccess = await waitForConfirmedTaskAccess(page, approvalContext);
    if (!confirmedTaskAccess.verified) {
      await updatePortalApprovalSessionStateForWorker({
        approvalId,
        userId: approval.userId,
        status: "ACTIVE",
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
        expiresAt: buildApprovalExpiry(new Date(), true),
      });
      return {
        type: "CYBER_CAMPUS_APPROVAL",
        state: "PENDING",
        approvalId,
      };
    }

    await completeApproval({
      approvalId,
      userId: approval.userId,
      jobId: approval.jobId,
      page,
    });
    continuation = {
      browser,
      context,
      page,
      jobId: approval.jobId,
      userId: approval.userId,
    };
    return { type: "CYBER_CAMPUS_APPROVAL", state: "COMPLETED", approvalId, continuation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isReauthRequiredMessage(message)) {
      await markAccountNeedsReauth(approval.userId, message);
    }
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
    if (!continuation) {
      await context.close();
      await browser.close();
    }
  }
}
