import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk, parseBody, requireAuthContext } from "@/lib/http";
import { writeAuditLog } from "@/server/audit-log";
import { requestCyberCampusAutoLearn } from "@/server/cyber-campus-autolearn";
import { getCurrentPortalProvider } from "@/server/current-provider";
import { dispatchManualJob } from "@/server/manual-dispatch-policy";
import { enqueueJob } from "@/server/queue";

const BodySchema = z.object({
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
      return jsonError("lectureSeq is required for SINGLE modes", 400);
    }

    const userId = context.effective.userId;
    const provider = await getCurrentPortalProvider(userId);

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
        ? "A matching auto-learning request already exists and will continue after the current run."
        : "The previous auto-learning request looked stale, so a new dispatch was prepared."
      : dispatch.dispatched
        ? "Auto-learning request queued and will start soon."
        : "Auto-learning request queued, but worker dispatch is delayed.";

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
    return jsonError(error instanceof Error ? error.message : "Failed to request auto-learning", 500);
  }
}
