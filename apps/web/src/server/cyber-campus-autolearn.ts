import { JobStatus, JobType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCu12Credentials, markCu12Status } from "@/server/cu12-account";
import { CyberCampusSessionClient, type SecondaryAuthMethod } from "@/server/cyber-campus-session";
import { dispatchWorkerRun, type WorkerDispatchResult } from "@/server/github-actions-dispatch";
import {
  createPortalApprovalSession,
  findActivePortalApprovalSession,
  getPortalApprovalSession,
  getPortalSession,
  markPortalSessionInvalid,
  upsertPortalSession,
  updatePortalApprovalSessionState,
} from "@/server/portal-session-store";
import { enqueueJob } from "@/server/queue";

const CYBER_CAMPUS_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CYBER_CAMPUS_APPROVAL_TTL_MS = 10 * 60 * 1000;
const CYBER_CAMPUS_APPROVAL_ACTIVE_TTL_MS = 5 * 60 * 1000;

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

type ApprovalSessionStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";
type PortalSessionStatus = "ACTIVE" | "EXPIRED" | "INVALID";

interface CyberCampusApprovalRow {
  id: string;
  jobId: string;
  status: ApprovalSessionStatus;
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
    status: "PENDING";
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
    dispatch: WorkerDispatchResult;
  };

function buildSessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CYBER_CAMPUS_SESSION_TTL_MS);
}

function buildApprovalExpiry(now = new Date(), active = false): Date {
  return new Date(now.getTime() + (active ? CYBER_CAMPUS_APPROVAL_ACTIVE_TTL_MS : CYBER_CAMPUS_APPROVAL_TTL_MS));
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
    });
    return null;
  }

  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status,
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

async function validateReusablePortalSession(userId: string): Promise<boolean> {
  const row = await getPortalSession(userId, "CYBER_CAMPUS");
  if (!row) return false;

  if (row.status !== "ACTIVE") {
    return false;
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    await markPortalSessionInvalid(userId, "CYBER_CAMPUS");
    return false;
  }

  const client = new CyberCampusSessionClient({ cookieState: row.cookieState });
  if (!(await client.isAuthenticated())) {
    await markPortalSessionInvalid(userId, "CYBER_CAMPUS");
    return false;
  }

  const secondary = await client.checkSecondaryAuth();
  if (!secondary.ready) {
    await markPortalSessionInvalid(userId, "CYBER_CAMPUS");
    return false;
  }

  await upsertPortalSession({
    userId,
    provider: "CYBER_CAMPUS",
    cookieState: client.exportCookieState(),
    expiresAt: buildSessionExpiry(),
    status: "ACTIVE",
  });
  return true;
}

async function queueCyberCampusAutoLearnJob(input: RequestCyberCampusAutoLearnInput) {
  const lecturePart = typeof input.lectureSeq === "number" ? String(input.lectureSeq) : "all";
  const { job, deduplicated } = await enqueueJob({
    userId: input.userId,
    type: JobType.AUTOLEARN,
    payload: {
      userId: input.userId,
      provider: "CYBER_CAMPUS",
      lectureSeq: input.lectureSeq,
      autoLearnMode: input.mode,
      reason: input.reason ?? "manual_request",
    },
    idempotencyKey: `autolearn:${input.userId}:CYBER_CAMPUS:${input.mode}:${lecturePart}`,
  });

  const dispatch = await dispatchWorkerRun("autolearn", input.userId);
  return { job, deduplicated, dispatch };
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
      notice: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15\uC740 2\uCC28 \uC778\uC99D\uC774 \uC644\uB8CC\uB420 \uB54C\uAE4C\uC9C0 \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.",
    };
  }

  if (await validateReusablePortalSession(input.userId)) {
    const queued = await queueCyberCampusAutoLearnJob(input);
    return {
      kind: "QUEUED",
      jobId: queued.job.id,
      status: "PENDING",
      deduplicated: queued.deduplicated,
      dispatched: queued.dispatch.dispatched,
      dispatchState: queued.dispatch.state,
      dispatchError: queued.dispatch.error,
      dispatchErrorCode: queued.dispatch.errorCode,
      notice: queued.deduplicated
        ? "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15 \uC694\uCCAD\uC774 \uC774\uBBF8 \uC788\uC5B4 \uD604\uC7AC \uC791\uC5C5 \uB4A4\uC5D0 \uC774\uC5B4\uC11C \uC9C4\uD589\uB429\uB2C8\uB2E4."
        : "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15 \uC694\uCCAD\uC744 \uC811\uC218\uD588\uC2B5\uB2C8\uB2E4.",
    };
  }

  const creds = await resolveCyberCampusCredentials(input.userId);
  const client = new CyberCampusSessionClient();
  const authenticated = await client.ensureAuthenticated({
    cu12Id: creds.cu12Id,
    cu12Password: creds.cu12Password,
  });
  if (!authenticated) {
    await markCu12Status(input.userId, "NEEDS_REAUTH", "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    throw new Error("\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uACC4\uC815 \uC5F0\uACB0 \uC0C1\uD0DC\uB97C \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
  }

  const secondary = await client.checkSecondaryAuth();
  if (secondary.ready) {
    await upsertPortalSession({
      userId: input.userId,
      provider: "CYBER_CAMPUS",
      cookieState: client.exportCookieState(),
      expiresAt: buildSessionExpiry(),
      status: "ACTIVE",
    });
    const queued = await queueCyberCampusAutoLearnJob(input);
    return {
      kind: "QUEUED",
      jobId: queued.job.id,
      status: "PENDING",
      deduplicated: queued.deduplicated,
      dispatched: queued.dispatch.dispatched,
      dispatchState: queued.dispatch.state,
      dispatchError: queued.dispatch.error,
      dispatchErrorCode: queued.dispatch.errorCode,
      notice: queued.deduplicated
        ? "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15 \uC694\uCCAD\uC774 \uC774\uBBF8 \uC788\uC5B4 \uD604\uC7AC \uC791\uC5C5 \uB4A4\uC5D0 \uC774\uC5B4\uC11C \uC9C4\uD589\uB429\uB2C8\uB2E4."
        : "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15 \uC694\uCCAD\uC744 \uC811\uC218\uD588\uC2B5\uB2C8\uB2E4.",
    };
  }

  const wayInfo = await client.getSecondaryAuthWayInfo();
  if (wayInfo.methods.length === 0) {
    throw new Error("\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4\uC5D0\uC11C \uC0AC\uC6A9 \uAC00\uB2A5\uD55C 2\uCC28 \uC778\uC99D \uC218\uB2E8\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
  }

  const blockedJob = await prisma.jobQueue.create({
    data: {
      userId: input.userId,
      type: JobType.AUTOLEARN,
      status: JobStatus.BLOCKED,
      payload: {
        userId: input.userId,
        provider: "CYBER_CAMPUS",
        lectureSeq: input.lectureSeq,
        autoLearnMode: input.mode,
        reason: input.reason ?? "manual_request",
      },
      runAfter: new Date(),
      lastError: "SECONDARY_AUTH_REQUIRED",
    },
  });

  const approval = await createPortalApprovalSession({
    userId: input.userId,
    provider: "CYBER_CAMPUS",
    jobId: blockedJob.id,
    cookieState: client.exportCookieState(),
    methods: wayInfo.methods,
    expiresAt: buildApprovalExpiry(),
  });

  return {
    kind: "APPROVAL_REQUIRED",
    jobId: blockedJob.id,
    status: "BLOCKED",
    approval: serializeApproval({
      id: approval.id,
      jobId: approval.jobId,
      status: approval.status,
      methods: wayInfo.methods,
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
    notice: secondary.message ?? "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC790\uB3D9 \uC218\uAC15\uC744 \uC2DC\uC791\uD558\uB824\uBA74 2\uCC28 \uC778\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.",
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
    throw new Error("\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uC2B9\uC778 \uC138\uC158\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
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

  const client = new CyberCampusSessionClient({ cookieState: approval.cookieState });
  const started = await client.startSecondaryAuth({
    way: selectedMethod.way,
    param: selectedMethod.param,
    target: selectedMethod.target,
  });

  await updatePortalApprovalSessionState({
    id: approval.id,
    userId: input.userId,
    status: "ACTIVE",
    cookieState: client.exportCookieState(),
    selectedWay: started.way,
    selectedParam: started.param,
    selectedTarget: started.target,
    authSeq: started.authSeq,
    requestCode: started.requestCode,
    displayCode: started.displayCode,
    errorMessage: null,
    expiresAt: started.expiresAt ?? buildApprovalExpiry(new Date(), true),
  });

  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) {
    throw new Error("사이버캠퍼스 승인 세션 갱신 중 상태가 변경되었습니다.");
  }

  return serializeApproval({
    id: refreshed.id,
    jobId: refreshed.jobId,
    status: refreshed.status,
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

  if (!approval.authSeq || approval.selectedWay === null || approval.selectedParam === null) {
    throw new Error("사이버캠퍼스 2차 인증 요청이 아직 시작되지 않았습니다.");
  }

  const client = new CyberCampusSessionClient({ cookieState: approval.cookieState });
  const confirmation = await client.confirmSecondaryAuth({
    authSeq: approval.authSeq,
    way: approval.selectedWay,
    param: approval.selectedParam,
    code: input.code ?? null,
  });

  if (!confirmation.completed) {
    await updatePortalApprovalSessionState({
      id: approval.id,
      userId: input.userId,
      cookieState: client.exportCookieState(),
      errorMessage: confirmation.message ?? null,
      expiresAt: buildApprovalExpiry(new Date(), true),
    });

    const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
    if (!refreshed) {
      throw new Error("사이버캠퍼스 승인 세션 갱신 중 상태가 변경되었습니다.");
    }

    return {
      state: "PENDING",
      approval: serializeApproval({
        id: refreshed.id,
        jobId: refreshed.jobId,
        status: refreshed.status,
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
      })!,
    };
  }

  await upsertPortalSession({
    userId: input.userId,
    provider: "CYBER_CAMPUS",
    cookieState: client.exportCookieState(),
    expiresAt: buildSessionExpiry(),
    status: "ACTIVE",
  });

  await updatePortalApprovalSessionState({
    id: approval.id,
    userId: input.userId,
    status: "COMPLETED",
    cookieState: client.exportCookieState(),
    errorMessage: null,
    completedAt: new Date(),
    expiresAt: buildApprovalExpiry(new Date(), true),
  });

  await prisma.jobQueue.updateMany({
    where: {
      id: approval.jobId,
      userId: input.userId,
      status: JobStatus.BLOCKED,
    },
    data: {
      status: JobStatus.PENDING,
      runAfter: new Date(),
      lastError: null,
      finishedAt: null,
      startedAt: null,
      workerId: null,
      result: Prisma.DbNull,
    },
  });

  const dispatch = await dispatchWorkerRun("autolearn", input.userId);
  const refreshed = await getPortalApprovalSession(input.approvalId, input.userId);
  if (!refreshed) {
    throw new Error("사이버캠퍼스 승인 세션 완료 처리 중 상태가 변경되었습니다.");
  }

  return {
    state: "COMPLETED",
    approval: serializeApproval({
      id: refreshed.id,
      jobId: refreshed.jobId,
      status: refreshed.status,
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
    })!,
    jobId: approval.jobId,
    dispatch,
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
