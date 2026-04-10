import { PrismaClient, SiteNoticeDisplayTarget, SiteNoticeType } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [broadcastResult, maintenanceResult] = await Promise.all([
    prisma.siteNotice.updateMany({
      where: { type: SiteNoticeType.BROADCAST },
      data: { displayTarget: SiteNoticeDisplayTarget.BOTH },
    }),
    prisma.siteNotice.updateMany({
      where: { type: SiteNoticeType.MAINTENANCE },
      data: { displayTarget: SiteNoticeDisplayTarget.BOTH },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        broadcastUpdated: broadcastResult.count,
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
