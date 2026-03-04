import { NextRequest } from "next/server";
import { JobStatus, JobType } from "@prisma/client";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";

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
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const url = new URL(request.url);
  const page = Math.max(Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1, 1);
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Math.trunc(limitRaw) || 50, 1), 200);
  const type = parseJobType(url.searchParams.get("type"));
  const status = parseJobStatus(url.searchParams.get("status"));
  const userId = url.searchParams.get("userId")?.trim() || undefined;

  const where = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(userId ? { userId } : {}),
  };

  const total = await prisma.jobQueue.count({ where });
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const currentPage = Math.min(page, totalPages);

  const jobs = await prisma.jobQueue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (currentPage - 1) * limit,
    take: limit,
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      payload: true,
      result: true,
      attempts: true,
      runAfter: true,
      workerId: true,
      startedAt: true,
      finishedAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });

  return jsonOk({
    jobs,
    pagination: {
      page: currentPage,
      limit,
      total,
      totalPages,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
    },
  });
}

