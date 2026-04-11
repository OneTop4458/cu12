import { PrismaClient, SiteNoticeDisplayTarget, SiteNoticeType } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs() {
  const args = new Map();
  for (const rawArg of process.argv.slice(2)) {
    const normalized = rawArg.replace(/^--/, "");
    if (!normalized) continue;
    const [key, ...valueParts] = normalized.split("=");
    if (!key) continue;
    args.set(key, valueParts.length > 0 ? valueParts.join("=") : "true");
  }
  return args;
}

function parseDisplayTarget(args, key, fallback) {
  const value = args.get(key);
  if (!value) return fallback;
  if (!Object.values(SiteNoticeDisplayTarget).includes(value)) {
    throw new Error(`Invalid ${key} display target: ${value}`);
  }
  return value;
}

async function main() {
  const args = parseArgs();
  if (!args.has("force")) {
    throw new Error(
      "Refusing to rewrite all site notice display targets without --force. This script is manual recovery only.",
    );
  }

  const broadcastTarget = parseDisplayTarget(args, "broadcast", SiteNoticeDisplayTarget.BOTH);
  const maintenanceTarget = parseDisplayTarget(args, "maintenance", SiteNoticeDisplayTarget.TOPBAR);

  const [broadcastResult, maintenanceResult] = await Promise.all([
    prisma.siteNotice.updateMany({
      where: { type: SiteNoticeType.BROADCAST },
      data: { displayTarget: broadcastTarget },
    }),
    prisma.siteNotice.updateMany({
      where: { type: SiteNoticeType.MAINTENANCE },
      data: { displayTarget: maintenanceTarget },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        broadcastTarget,
        broadcastUpdated: broadcastResult.count,
        maintenanceTarget,
        maintenanceUpdated: maintenanceResult.count,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
