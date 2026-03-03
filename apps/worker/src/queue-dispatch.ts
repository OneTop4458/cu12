import { writeFile } from "node:fs/promises";
import { JobStatus, JobType } from "@prisma/client";
import { prisma } from "./prisma";

function parseArgs() {
  const map = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    if (k && v) map.set(k, v);
  }
  return map;
}

interface DispatchSummary {
  type: JobType;
  scannedCount: number;
  createdCount: number;
  skippedExistingCount: number;
  skippedIntervalCount: number;
  minIntervalMinutes: number;
  generatedAt: string;
}

async function resolveUsers(type: JobType, userId?: string) {
  if (userId) {
    return prisma.user.findMany({
      where: { id: userId },
      select: { id: true },
    });
  }

  if (type === JobType.MAIL_DIGEST) {
    return prisma.user.findMany({
      where: {
        mailSubs: {
          some: {
            enabled: true,
            digestEnabled: true,
          },
        },
      },
      select: { id: true },
    });
  }

  if (type === JobType.AUTOLEARN) {
    return prisma.user.findMany({
      where: {
        cu12Account: {
          is: {
            accountStatus: "CONNECTED",
            autoLearnEnabled: true,
          },
        },
      },
      select: { id: true },
    });
  }

  return prisma.user.findMany({
    where: {
      cu12Account: {
        is: {
          accountStatus: "CONNECTED",
        },
      },
    },
    select: { id: true },
  });
}

async function main() {
  const args = parseArgs();
  const typeRaw = args.get("type") ?? "SYNC";
  const userId = args.get("userId");
  const minIntervalMinutes = Math.max(0, Number(args.get("min-interval-minutes") ?? "0"));
  const summaryJson = args.get("summary-json");

  if (!Object.values(JobType).includes(typeRaw as JobType)) {
    throw new Error(`Invalid job type: ${typeRaw}`);
  }
  const type = typeRaw as JobType;

  const users = await resolveUsers(type, userId);
  const cutoff = new Date(Date.now() - minIntervalMinutes * 60_000);

  const summary: DispatchSummary = {
    type,
    scannedCount: users.length,
    createdCount: 0,
    skippedExistingCount: 0,
    skippedIntervalCount: 0,
    minIntervalMinutes,
    generatedAt: new Date().toISOString(),
  };

  for (const user of users) {
    const key = `${type.toLowerCase()}:${user.id}:scheduled`;
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: user.id,
        type,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        idempotencyKey: key,
      },
      select: { id: true },
    });

    if (existing) {
      summary.skippedExistingCount += 1;
      continue;
    }

    if (minIntervalMinutes > 0) {
      const recent = await prisma.jobQueue.findFirst({
        where: {
          userId: user.id,
          type,
          status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.SUCCEEDED] },
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });

      if (recent) {
        summary.skippedIntervalCount += 1;
        continue;
      }
    }

    await prisma.jobQueue.create({
      data: {
        userId: user.id,
        type,
        status: JobStatus.PENDING,
        payload: { userId: user.id, reason: "scheduled_dispatch" },
        idempotencyKey: key,
        runAfter: new Date(),
      },
    });
    summary.createdCount += 1;
  }

  if (summaryJson) {
    await writeFile(summaryJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(summary));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
