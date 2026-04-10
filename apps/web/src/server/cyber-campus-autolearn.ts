import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCu12Credentials } from "@/server/cu12-account";
import { dispatchWorkerRun, type WorkerDispatchResult } from "@/server/github-actions-dispatch";
import {
  createPortalApprovalSession,
  findActivePortalApprovalSession,
  getPortalApprovalSession,
  getPortalSession,
  type PortalApprovalRequestedAction,
  updatePortalApprovalSessionState,
} from "@/server/portal-session-store";

const CYBER_CAMPUS_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CYBER_CAMPUS_APPROVAL_TTL_MS = 10 * 60 * 1000;
const CYBER_CAMPUS_APPROVAL_ACTIVE_TTL_MS = 5 * 60 * 1000;

type ApprovalSessionStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";
type PortalSessionStatus = "ACTIVE" | "EXPIRED" | "INVALID";
type SecondaryAuthMethod = {
  way: number;
  param: string;
  target: string;
  label: string;
  requiresCode: boolean;
};

interface CyberCampusApprovalRow {
  id: string;
  jobId: string;
  status: ApprovalSessionStatus;
  requestedAction: PortalApprovalRequestedAction | null;
  methods: SecondaryAuthMethod[];
  selectedWay: number | null;
  selectedParam: string | null;
  selectedTarget: string | null;
  requestCode: string | null;
  displayCode: string | null;
  errorMessage: string | null;
  expiresAt: Date;
  completedAt: Date | null;
  canceledAt: Date | null;
}

export interface CyberCampusPortalSessionSummary {
  available: boolean;
  status: PortalSessionStatus | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
}

export interface CyberCampusApprovalSummary {
  id: string;
  jobId: string;
  status: ApprovalSessionStatus;
  requestedAction: PortalApprovalRequestedAction | null;
  expiresAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  errorMessage: string | null;
  methods: SecondaryAuthMethod[];
  selectedMethod: SecondaryAuthMethod | null;
  requestCode: string | null;
  displayCode: string | null;
}

export interface CyberCampusApprovalState {
  session: CyberCampusPortalSessionSummary;
  approval: CyberCampusApprovalSummary | null;
}

export interface RequestCyberCampusAutoLearnInput {
  userId: string;
  mode: "SINGLE_NEXT" | "SINGLE_ALL" | "ALL_COURSES";
  lectureSeq?: number;
  reason?: string;
}

export type RequestCyberCampusAutoLearnResult =
  | {
    kind: "QUEUED";
    jobId: string;
    status: "PENDING" | "RUNNING";
    deduplicated: boolean;
    dispatched: boolean;
    dispatchState: WorkerDispatchResult["state"];
    dispatchError?: string;
    dispatchErrorCode?: string | null;
    notice: string;
  }
  | {
    kind: "APPROVAL_PENDING";
    jobId: string;
    status: "BLOCKED";
    deduplicated: boolean;
    dispatched: boolean;
    dispatchState: WorkerDispatchResult["state"];
    dispatchError?: string;
    dispatchErrorCode?: string | null;
    notice: string;
  }
  | {
    kind: "APPROVAL_REQUIRED";
    jobId: string;
    status: "BLOCKED";
    approval: CyberCampusApprovalSummary;
    notice: string;
  };

export type ConfirmCyberCampusApprovalResult =
  | {
    state: "PENDING";
    approval: CyberCampusApprovalSummary;
  }
  | {
    state: "COMPLETED";
    approval: CyberCampusApprovalSummary;
    jobId: string;
  };

function isMissingPortalSessionStoreError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /(portalsession|portalapprovalsession)/i.test(error.message);
  }

  if (error instanceof Error) {
    return /(portalsession|portalapprovalsession)/i.test(error.message)
      && /(table|column|does not exist|unknown)/i.test(error.message);
  }

  return false;
}

function buildSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CYBER_CAMPUS_SESSION_TTL_MS);
}

function buildApprovalExpiry(now = new Date(), active = false): Date {
  return new Date(now.getTime() + (active ? CYBER_CAMPUS_APPROVAL_ACTIVE_TTL_MS : CYBER_CAMPUS_APPROVAL_TTL_MS));
}

function buildApprovalDispatchNotice(dispatched: boolean): string {
  if (dispatched) {
    return "사이버캠퍼스 자동 수강 요청을 접수했고, worker가 강의별 인증 필요 여부를 확인 중입니다.";
  }
  return "사이버캠퍼스 자동 수강 요청을 접수했습니다. 인증 필요 여부 확인이 다소 지연되고 있으니 잠시 후 다시 확인해 주세요.";
}

function buildQueuedNotice(deduplicated: boolean, dispatched: boolean): string {
  if (deduplicated) {
    return "같은 조건의 사이버캠퍼스 자동 수강 요청이 이미 있어 현재 작업이 끝난 뒤 이어서 진행됩니다.";
  }
  if (dispatched) {
    return "사이버캠퍼스 자동 수강 요청을 접수했습니다.";
  }
  return "사이버캠퍼스 자동 수강 요청을 접수했지만 worker 실행이 지연되고 있습니다.";
}

function buildAutoLearnIdempotencyKey(input: RequestCyberCampusAutoLearnInput): string {
  const lecturePart = typeof input.lectureSeq === "number" ? String(input.lectureSeq) : "all";
  return `autolearn:${input.userId}:CYBER_CAMPUS:${input.mode}:${lecturePart}`;
}

function serializePortalSession(row: {
  status: PortalSessionStatus;
  expiresAt: Date | null;
  lastVerifiedAt: Date | null;
} | null): CyberCampusPortalSessionSummary {
  return {
    available: Boolean(row && row.status === "ACTIVE" && (!row.expiresAt || row.expiresAt.getTime() > Date.now())),
    status: row?.status ?? null,
    expiresAt: row?.expiresAt?.toISOString() ?? null,
    lastVerifiedAt: row?.lastVerifiedAt?.toISOString() ?? null,
  };
}

function resolveSelectedMethod(row: CyberCampusApprovalRow): SecondaryAuthMethod | null {
  if (row.selectedWay === null) return null;
  return row.methods.find((method) => (
    method.way === row.selectedWay
    && method.param === (row.selectedParam ?? "")
  )) ?? null;
}

function serializeApproval(row: CyberCampusApprovalRow | null): CyberCampusApprovalSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    requestedAction: row.requestedAction,
    expiresAt: row.expiresAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    methods: row.methods,
    selectedMethod: resolveSelectedMethod(row),
    requestCode: row.requestCode,
    displayCode: row.displayCode,
  };
}

async function resolveCyberCampusCredentials(userId: string) {
  const creds = await getCu12Credentials(userId);
  if (!creds) {
    throw new Error("사이버캠퍼스 계정이 연결되어 있지 않습니다.");
  }
  return creds;
}

async function expireBlockedJob(jobId: string, reason: string) {
  await prisma.jobQueue.updateMany({
    where: {
      id: jobId,
      status: JobStatus.BLOCKED,
    },
    data: {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      lastError: reason,
    },
  });
}

async function expireApprovalIfNeeded(row: {
  id: string;
  jobId: string;
  userId: string;
  status: ApprovalSessionStatus;
  expiresAt: Date;
}): Promise<boolean> {
  if ((row.status !== "PENDING" && row.status !== "ACTIVE") || row.expiresAt.getTime() > Date.now()) {
    return false;
  }

  await updatePortalApprovalSessionState({
    id: row.id,
    userId: row.userId,
    status: "EXPIRED",
    requestedAction: null,
    pendingCode: null,
  });
  await expireBlockedJob(row.jobId, "SECONDARY_AUTH_TIMEOUT");
  return true;
}

async function resolveActiveApproval(userId: string): Promise<CyberCampusApprovalRow | null> {
  const row = await findActivePortalApprovalSession(userId, "CYBER_CAMPUS");
  if (!row) return null;

  const expired = await expireApprovalIfNeeded(row);
  if (expired) {
    return null;
  }

  const job = await prisma.jobQueue.findFirst({
    where: {
      id: row.jobId,
      userId,
      type: JobType.AUTOLEARN,
    },
    select: {
      status: true,
    },
  });

  if (!job || job.status !== JobStatus.BLOCKED) {
    await updatePortalApprovalSessionState({
      id: row.id,
      userId,
      status: "CANCELED",
      canceledAt: new Date(),
      errorMessage: "승인 세션에 연결된 자동 수강 작업을 찾을 수 없습니다.",
      requestedAction: null,
      pendingCode: null,
    });
    return null;
  }

  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
    requestedAction: row.requestedAction,
    methods: row.methods,
    selectedWay: row.selectedWay,
    selectedParam: row.selectedParam,
    selectedTarget: row.selectedTarget,
    requestCode: row.requestCode,
    displayCode: row.displayCode,
    errorMessage: row.errorMessage,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
    canceledAt: row.canceledAt,
  };
}

async function findQueuedAutoLearnJob(input: RequestCyberCampusAutoLearnInput) {
  return prisma.jobQueue.findFirst({
    where: {
      userId: input.userId,
      type: JobType.AUTOLEARN,
      idempotencyKey: buildAutoLearnIdempotencyKey(input),
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function createBlockedAutoLearnJob(input: RequestCyberCampusAutoLearnInput) {
  return prisma.jobQueue.create({
    data: {
      userId: input.userId,
      type: JobType.AUTOLEARN,
      status: JobStatus.BLOCKED,
      idempotencyKey: buildAutoLearnIdempotencyKey(input),
      payload: {
        userId: input.userId,
        provider: "CYBER_CAMPUS",
        lectureSeq: input.lectureSeq,
        autoLearnMode: input.mode,
        reason: input.reason ?? "manual_request",
      },
      runAfter: new Date(),
      lastError: "CYBER_CAMPUS_APPROVAL_CHECK_PENDING",
    },
  });
}

async function dispatchCyberCampusApproval(approvalId: string): Promise<WorkerDispatchResult> {
  return dispatchWorkerRun("cyber-campus-approval", undefined, undefined, approvalId);
}

async function updateApprovalAction(input: {
  id: string;
  userId: string;
  action: PortalApprovalRequestedAction;
  pendingCode?: string | null;
  selectedMethod?: SecondaryAuthMethod | null;
  expiresAt: Date;
}) {
  await updatePortalApprovalSessionState({
    id: input.id,
    userId: input.userId,
    status: "PENDING",
    requestedAction: input.action,
    pendingCode: input.pendingCode ?? null,
    selectedWay: input.selectedMethod?.way ?? null,
    selectedParam: input.selectedMethod?.param ?? null,
    selectedTarget: input.selectedMethod?.target ?? null,
    authSeq: input.action === "START" ? null : undefined,
    requestCode: input.action === "START" ? null : undefined,
    displayCode: input.action === "START" ? null : undefined,
    errorMessage: null,
    completedAt: null,
    canceledAt: null,
    expiresAt: input.expiresAt,
  });
}

export async function getCyberCampusApprovalState(userId: string): Promise<CyberCampusApprovalState> {
  try {
    const portalSession = await getPortalSession(userId, "CYBER_CAMPUS");
    const approval = await resolveActiveApproval(userId);
    return {
      session: serializePortalSession(portalSession),
      approval: serializeApproval(approval),
    };
  } catch (error) {
    if (!isMissingPortalSessionStoreError(error)) {
      throw error;
    }

    return {
      session: {
        available: false,
        status: null,
        expiresAt: null,
        lastVerifiedAt: null,
      },
      approval: null,
    };
  }
}

export async function requestCyberCampusAutoLearn(
  input: RequestCyberCampusAutoLearnInput,
): Promise<RequestCyberCampusAutoLearnResult> {
  await resolveCyberCampusCredentials(input.userId);

  const activeApproval = await resolveActiveApproval(input.userId);
  if (activeApproval) {
    return {
      kind: "APPROVAL_REQUIRED",
      jobId: activeApproval.jobId,
      status: "BLOCKED",
      approval: serializeApproval(activeApproval)!,
      notice: "사이버캠퍼스 자동 수강은 필요한 인증이 완료될 때까지 대기 중입니다.",
    };
  }

  const existingJob = await findQueuedAutoLearnJob(input);
  if (existingJob) {
    const dispatch = await dispatchWorkerRun("autolearn", input.userId);
    return {
      kind: "QUEUED",
      jobId: existingJob.id,
      status: existingJob.status === JobStatus.RUNNING ? "RUNNING" : "PENDING",
      deduplicated: true,
      dispatched: dispatch.dispatched,
      dispatchState: dispatch.state,
      dispatchError: dispatch.error,
      dispatchErrorCode: dispatch.errorCode,
      notice: buildQueuedNotice(true, dispatch.dispatched),
    };
  }

  const portalSession = await getPortalSession(input.userId, "CYBER_CAMPUS");
  const blockedJob = await createBlockedAutoLearnJob(input);
  const approval = await createPortalApprovalSession({
    userId: input.userId,
    provider: "CYBER_CAMPUS",
    jobId: blockedJob.id,
    cookieState: portalSession?.cookieState ?? [],
    methods: [],
    expiresAt: buildApprovalExpiry(),
    requestedAction: "BOOTSTRAP",
  });
  const dispatch = await dispatchCyberCampusApproval(approval.id);

  return {
    kind: "APPROVAL_PENDING",
    jobId: blockedJob.id,
    status: "BLOCKED",
    deduplicated: false,
    dispatched: dispatch.dispatched,
    dispatchState: dispatch.state,
    dispatchError: dispatch.error,
    dispatchErrorCode: dispatch.errorCode,
    notice: buildApprovalDispatchNotice(dispatch.dispatched),
  };
}

export async function startCyberCampusApproval(input: {
  userId: string;
  approvalId: string;
  way: number;
  param?: string | null;
}): Promise<CyberCampusApprovalSummary> {
  const approval = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!approval) {
    throw new Error("사이버캠퍼스 승인 세션을 찾을 수 없습니다.");
  }

  const expired = await expireApprovalIfNeeded(approval);
  if (expired) {
    throw new Error("사이버캠퍼스 승인 세션이 만료되었습니다.");
  }

  if (approval.status === "COMPLETED") {
    return serializeApproval({
      id: approval.id,
      jobId: approval.jobId,
      status: approval.status,
      requestedAction: approval.requestedAction,
      methods: approval.methods,
      selectedWay: approval.selectedWay,
      selectedParam: approval.selectedParam,
      selectedTarget: approval.selectedTarget,
      requestCode: approval.requestCode,
      displayCode: approval.displayCode,
      errorMessage: approval.errorMessage,
      expiresAt: approval.expiresAt,
      completedAt: approval.completedAt,
      canceledAt: approval.canceledAt,
    })!;
  }

  const selectedMethod = approval.methods.find((method: SecondaryAuthMethod) => (
    method.way === input.way
    && method.param === (input.param ?? method.param)
  ));
  if (!selectedMethod) {
    throw new Error("선택한 사이버캠퍼스 2차 인증 수단이 유효하지 않습니다.");
  }

  await updateApprovalAction({
    id: approval.id,
    userId: input.userId,
    action: "START",
    pendingCode: null,
    selectedMethod,
    expiresAt: buildApprovalExpiry(),
  });
  await dispatchCyberCampusApproval(approval.id);

  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) {
    throw new Error("사이버캠퍼스 승인 세션 갱신 중 상태가 변경되었습니다.");
  }

  return serializeApproval({
    id: refreshed.id,
    jobId: refreshed.jobId,
    status: refreshed.status,
    requestedAction: refreshed.requestedAction,
    methods: refreshed.methods,
    selectedWay: refreshed.selectedWay,
    selectedParam: refreshed.selectedParam,
    selectedTarget: refreshed.selectedTarget,
    requestCode: refreshed.requestCode,
    displayCode: refreshed.displayCode,
    errorMessage: refreshed.errorMessage,
    expiresAt: refreshed.expiresAt,
    completedAt: refreshed.completedAt,
    canceledAt: refreshed.canceledAt,
  })!;
}

export async function confirmCyberCampusApproval(input: {
  userId: string;
  approvalId: string;
  code?: string | null;
}): Promise<ConfirmCyberCampusApprovalResult> {
  const approval = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!approval) {
    throw new Error("사이버캠퍼스 승인 세션을 찾을 수 없습니다.");
  }

  const expired = await expireApprovalIfNeeded(approval);
  if (expired) {
    throw new Error("사이버캠퍼스 승인 세션이 만료되었습니다.");
  }

  if (approval.status === "COMPLETED") {
    return {
      state: "COMPLETED",
      approval: serializeApproval({
        id: approval.id,
        jobId: approval.jobId,
        status: approval.status,
        requestedAction: approval.requestedAction,
        methods: approval.methods,
        selectedWay: approval.selectedWay,
        selectedParam: approval.selectedParam,
        selectedTarget: approval.selectedTarget,
        requestCode: approval.requestCode,
        displayCode: approval.displayCode,
        errorMessage: approval.errorMessage,
        expiresAt: approval.expiresAt,
        completedAt: approval.completedAt,
        canceledAt: approval.canceledAt,
      })!,
      jobId: approval.jobId,
    };
  }

  const selectedMethod = approval.methods.find((method: SecondaryAuthMethod) => (
    method.way === approval.selectedWay
    && method.param === (approval.selectedParam ?? "")
  ));
  if (!selectedMethod) {
    throw new Error("먼저 사이버캠퍼스 2차 인증 수단을 선택해 주세요.");
  }
  if (selectedMethod.requiresCode && !input.code?.trim()) {
    throw new Error("인증 코드를 입력해 주세요.");
  }

  await updateApprovalAction({
    id: approval.id,
    userId: input.userId,
    action: "CONFIRM",
    pendingCode: selectedMethod.requiresCode ? input.code?.trim() ?? null : null,
    selectedMethod,
    expiresAt: buildApprovalExpiry(new Date(), true),
  });
  await dispatchCyberCampusApproval(approval.id);

  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) {
    throw new Error("사이버캠퍼스 승인 세션 갱신 중 상태가 변경되었습니다.");
  }

  const serialized = serializeApproval({
    id: refreshed.id,
    jobId: refreshed.jobId,
    status: refreshed.status,
    requestedAction: refreshed.requestedAction,
    methods: refreshed.methods,
    selectedWay: refreshed.selectedWay,
    selectedParam: refreshed.selectedParam,
    selectedTarget: refreshed.selectedTarget,
    requestCode: refreshed.requestCode,
    displayCode: refreshed.displayCode,
    errorMessage: refreshed.errorMessage,
    expiresAt: refreshed.expiresAt,
    completedAt: refreshed.completedAt,
    canceledAt: refreshed.canceledAt,
  })!;

  if (refreshed.status === "COMPLETED") {
    return {
      state: "COMPLETED",
      approval: serialized,
      jobId: refreshed.jobId,
    };
  }

  return {
    state: "PENDING",
    approval: serialized,
  };
}

export async function cancelCyberCampusApproval(input: {
  userId: string;
  approvalId: string;
}): Promise<CyberCampusApprovalSummary> {
  const approval = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!approval) {
    throw new Error("사이버캠퍼스 승인 세션을 찾을 수 없습니다.");
  }

  await updatePortalApprovalSessionState({
    id: approval.id,
    userId: input.userId,
    status: "CANCELED",
    canceledAt: new Date(),
    errorMessage: "사용자가 2차 인증을 취소했습니다.",
    requestedAction: null,
    pendingCode: null,
  });

  await prisma.jobQueue.updateMany({
    where: {
      id: approval.jobId,
      userId: input.userId,
      status: JobStatus.BLOCKED,
    },
    data: {
      status: JobStatus.CANCELED,
      finishedAt: new Date(),
      lastError: "SECONDARY_AUTH_CANCELED",
    },
  });

  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) {
    throw new Error("사이버캠퍼스 승인 세션 취소 처리 중 상태가 변경되었습니다.");
  }

  return serializeApproval({
    id: refreshed.id,
    jobId: refreshed.jobId,
    status: refreshed.status,
    requestedAction: refreshed.requestedAction,
    methods: refreshed.methods,
    selectedWay: refreshed.selectedWay,
    selectedParam: refreshed.selectedParam,
    selectedTarget: refreshed.selectedTarget,
    requestCode: refreshed.requestCode,
    displayCode: refreshed.displayCode,
    errorMessage: refreshed.errorMessage,
    expiresAt: refreshed.expiresAt,
    completedAt: refreshed.completedAt,
    canceledAt: refreshed.canceledAt,
  })!;
}

export async function getCyberCampusApprovalSummary(input: {
  userId: string;
  approvalId: string;
}): Promise<CyberCampusApprovalSummary | null> {
  const approval = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!approval) return null;

  await expireApprovalIfNeeded(approval);
  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) return null;

  return serializeApproval({
    id: refreshed.id,
    jobId: refreshed.jobId,
    status: refreshed.status,
    requestedAction: refreshed.requestedAction,
    methods: refreshed.methods,
    selectedWay: refreshed.selectedWay,
    selectedParam: refreshed.selectedParam,
    selectedTarget: refreshed.selectedTarget,
    requestCode: refreshed.requestCode,
    displayCode: refreshed.displayCode,
    errorMessage: refreshed.errorMessage,
    expiresAt: refreshed.expiresAt,
    completedAt: refreshed.completedAt,
    canceledAt: refreshed.canceledAt,
  });
}

export { buildSessionExpiry, buildApprovalExpiry };
