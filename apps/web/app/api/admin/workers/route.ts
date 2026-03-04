import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdminActor } from "@/lib/http";
import { prisma } from "@/lib/prisma";

function parseInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? `${fallback}`);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export async function GET(request: NextRequest) {
  const context = await requireAdminActor(request);
  if (!context) return jsonError("Forbidden", 403);

  const url = new URL(request.url);
  const staleMinutes = parseInteger(url.searchParams.get("staleMinutes"), 10, 120);
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - staleMinutes * 60_000);

  const workers = await prisma.workerHeartbeat.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: { workerId: true, lastSeenAt: true },
  });

  const activeWorkers = workers.filter((worker) => worker.lastSeenAt.getTime() >= staleCutoff.getTime());

  return jsonOk({
    workers,
    summary: {
      total: workers.length,
      active: activeWorkers.length,
      stale: workers.length - activeWorkers.length,
      staleMinutes,
      capturedAt: now.toISOString(),
      staleCutoff: staleCutoff.toISOString(),
    },
  });
}

