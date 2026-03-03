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

async function main() {
  const args = parseArgs();
  const typeRaw = args.get("type") ?? "SYNC";
  const userId = args.get("userId");

  if (!Object.values(JobType).includes(typeRaw as JobType)) {
    throw new Error(`Invalid job type: ${typeRaw}`);
  }
  const type = typeRaw as JobType;

  const users = userId
    ? await prisma.user.findMany({ where: { id: userId }, select: { id: true } })
    : await prisma.user.findMany({ select: { id: true } });

  for (const user of users) {
    const key = `${type.toLowerCase()}:${user.id}:scheduled`;
    const existing = await prisma.jobQueue.findFirst({
      where: {
        userId: user.id,
        type,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        idempotencyKey: key,
      },
    });

    if (existing) continue;

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
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
