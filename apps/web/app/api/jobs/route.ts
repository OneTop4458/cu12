import { NextRequest } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { jsonError, jsonOk, requireUser } from "@/lib/http";
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
  const session = await requireUser(request);
  if (!session) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const type = parseJobType(url.searchParams.get("type"));
  const status = parseJobStatus(url.searchParams.get("status"));

  const jobs = await listJobsForUser(session.userId, Math.min(Math.max(limit, 1), 100), type, status);
  return jsonOk({ jobs });
}
