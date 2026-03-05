import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { isWorkerAuthorized } from "@/lib/worker-auth";
import { getJobReconcileResult } from "@/server/jobs-reconcile";

export async function GET(request: NextRequest) {
  if (!isWorkerAuthorized(request)) {
    return jsonError("Forbidden", 403);
  }

  return jsonOk(await getJobReconcileResult());
}
