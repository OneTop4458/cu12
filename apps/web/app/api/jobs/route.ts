import { NextRequest } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { loadOptionalDashboardSegment } from "@/server/dashboard-fallback";
import { listJobsForUser } from "@/server/queue";

function parseJobType(raw: string | null): JobType | undefined {
  if (!raw) return undefined;
  if (Object.values(JobType).includes(raw as JobType)) {
    return raw as JobType;
  }
  return undefined;
}

function parseJobStatus(raw: string | null): JobStatus | undefined {
  if (!raw) return undefined;
  if (Object.values(JobStatus).includes(raw as JobStatus)) {
    return raw as JobStatus;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const type = parseJobType(url.searchParams.get("type"));
    const status = parseJobStatus(url.searchParams.get("status"));

    const jobs = await loadOptionalDashboardSegment(
      "jobs/list",
      "jobs",
      () => listJobsForUser(context.effective.userId, Math.min(Math.max(limit, 1), 100), type, status),
      [],
    );
    return jsonOk({ jobs });
  } catch (error) {
    console.error("[jobs/list] failed", error);
    return jsonError("Job list failed. Please refresh and try again.", 503, "JOB_LIST_FAILED");
  }
}

