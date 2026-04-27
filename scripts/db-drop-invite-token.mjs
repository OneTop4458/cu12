import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function inviteTokenTableExists() {
  const rows = await prisma.$queryRaw`
    SELECT to_regclass('"InviteToken"') IS NOT NULL AS "exists"
  `;
  return rows[0]?.exists === true;
}

if (!process.env.DATABASE_URL) {
  console.error("[db-sync] DATABASE_URL is required.");
  process.exit(1);
}

if (process.env.ALLOW_DROP_INVITE_TOKEN !== "true") {
  console.error("[db-sync] Refusing to drop InviteToken without ALLOW_DROP_INVITE_TOKEN=true.");
  process.exit(1);
}

try {
  const exists = await inviteTokenTableExists();
  if (!exists) {
    console.log("[db-sync] InviteToken table does not exist. Skipping scoped drop.");
    process.exit(0);
  }

  const rows = await prisma.$queryRaw`SELECT COUNT(*)::int AS "count" FROM "InviteToken"`;
  const count = Number(rows[0]?.count ?? 0);
  console.log(`[db-sync] Dropping InviteToken table with ${count} row(s). Token values are not logged.`);
  await prisma.$executeRaw`DROP TABLE IF EXISTS "InviteToken" CASCADE`;
  console.log("[db-sync] Dropped InviteToken table.");
} finally {
  await prisma.$disconnect();
}
