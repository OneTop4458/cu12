import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { requestCyberCampusAutoLearn } from "@/server/cyber-campus-autolearn";
import { getDashboardAccount } from "@/server/cu12-account";
import { PORTAL_PROVIDER_VALUES } from "@/server/portal-provider";
import { dispatchManualJob } from "@/server/manual-dispatch-policy";
import { enqueueJob } from "@/server/queue";

const BodySchema = z.object({
  provider: z.enum(PORTAL_PROVIDER_VALUES).optional(),
  mode: z.enum(["SINGLE_NEXT", "SINGLE_ALL", "ALL_COURSES"]).default("ALL_COURSES"),
  lectureSeq: z.number().int().positive().optional(),
  reason: z.string().max(200).optional(),
});

export async function POST(request: NextRequest) {
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  try {
    const body = await parseBody(request, BodySchema);
    const mode = body.mode ?? "ALL_COURSES";

    if (mode !== "ALL_COURSES" && !body.lectureSeq) {
      return jsonError("선택 강좌 모드에서는 lectureSeq가 필요합니다.", 400);
    }

    const userId = context.effective.userId;
    const account = await getDashboardAccount(userId);
    if (!account) {
      return jsonError("CU12 account is not connected", 400, "ACCOUNT_NOT_CONNECTED");
    }
    const provider = body.provider ?? account.provider;

    if (provider === "CYBER_CAMPUS") {
      const result = await requestCyberCampusAutoLearn({
        userId,
        mode,
        lectureSeq: body.lectureSeq,
        reason: body.reason ?? "manual_request",
      });

      await writeAuditLog({
        category: "JOB",
        severity: "INFO",
        actorUserId: context.actor.userId,
        targetUserId: userId,
        message: "Cyber Campus AUTOLEARN job requested",
        meta: {
          provider,
          jobId: result.jobId,
          mode,
          lectureSeq: body.lectureSeq ?? null,
          kind: result.kind,
          status: result.status,
        },
      });

      return jsonOk({
        provider,
        jobId: result.jobId,
        status: result.status,
        deduplicated: result.kind === "QUEUED" ? result.deduplicated : false,
        dispatched: result.kind === "QUEUED" ? result.dispatched : false,
        dispatchState: result.kind === "QUEUED" ? result.dispatchState : "NOT_APPLICABLE",
        dispatchError: result.kind === "QUEUED" ? result.dispatchError : null,
        dispatchErrorCode: result.kind === "QUEUED" ? result.dispatchErrorCode : null,
        notice: result.notice,
        approvalRequired: result.kind === "APPROVAL_REQUIRED",
        approval: result.kind === "APPROVAL_REQUIRED" ? result.approval : null,
      });
    }

    const lecturePart = body.lectureSeq ? String(body.lectureSeq) : "all";
    const { job, deduplicated } = await enqueueJob({
      userId,
      type: "AUTOLEARN",
      payload: {
        userId,
        provider,
        lectureSeq: body.lectureSeq,
        autoLearnMode: mode,
        reason: body.reason ?? "manual_request",
      },
      idempotencyKey: `autolearn:${userId}:${provider}:${mode}:${lecturePart}`,
    });

    const { dispatch } = await dispatchManualJob(userId, "autolearn", {
      deduplicated,
      status: job.status,
      createdAt: job.createdAt,
      runAfter: job.runAfter,
      startedAt: job.startedAt,
    });
    const notice = deduplicated
      ? dispatch.state === "SKIPPED_DUPLICATE"
        ? "같은 조건의 자동 수강 요청이 이미 있어 현재 작업이 끝난 뒤 이어서 진행됩니다."
        : "이전 자동 수강 요청이 지연된 것으로 보여 새 실행 준비를 다시 시작했습니다."
      : dispatch.dispatched
        ? "자동 수강 요청이 접수되었습니다. 곧 순서대로 시작됩니다."
        : "자동 수강 요청이 접수되었지만 worker 실행이 지연되고 있습니다.";

    await writeAuditLog({
      category: "JOB",
      severity: "INFO",
      actorUserId: context.actor.userId,
      targetUserId: userId,
      message: "AUTOLEARN job requested",
      meta: {
        provider,
        jobId: job.id,
        mode,
        lectureSeq: body.lectureSeq ?? null,
        deduplicated,
        dispatched: dispatch.dispatched,
        dispatchState: dispatch.state,
        dispatchErrorCode: dispatch.errorCode,
      },
    });

    return jsonOk({
      provider,
      jobId: job.id,
      status: job.status,
      deduplicated,
      dispatched: dispatch.dispatched,
      dispatchState: dispatch.state,
      dispatchError: dispatch.error,
      dispatchErrorCode: dispatch.errorCode,
      notice,
      approvalRequired: false,
      approval: null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError(error instanceof Error ? error.message : "자동 수강 요청 처리에 실패했습니다.", 500);
  }
}
