import { NextRequest } from "next/server";
import { JobType } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonOk, parseBody } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { dispatchWorkerRun, type WorkerDispatchType } from "@/server/github-actions-dispatch";

const BodySchema = z.object({
  trigger: z.enum(["sync", "autolearn", "digest", "cyber-campus-approval"]),
  userId: z.string().min(1).max(191).optional(),
  approvalId: z.string().min(1).max(191).optional(),
  jobTypes: z.array(z.nativeEnum(JobType)).optional(),
}).superRefine((body, ctx) => {
  if (body.trigger === "cyber-campus-approval" && !body.approvalId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["approvalId"],
      message: "approvalId is required for cyber-campus-approval",
    });
  }
});

export async function POST(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  try {
    const body = await parseBody(request, BodySchema);
    const trigger = body.trigger as WorkerDispatchType;
    const jobTypes = body.jobTypes?.join(",");
    const dispatched = await dispatchWorkerRun(trigger, body.userId, jobTypes, body.approvalId);
    return jsonOk(dispatched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(error.issues.map((it) => it.message).join(", "), 400);
    }
    return jsonError("Failed to request worker dispatch", 500);
  }
}
