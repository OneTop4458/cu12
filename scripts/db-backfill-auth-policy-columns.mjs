import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    `"${tableName}"`,
  );
  return rows[0]?.exists === true;
}

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS "exists"`,
    tableName,
    columnName,
  );
  return rows[0]?.exists === true;
}

if (!process.env.DATABASE_URL) {
  console.error("[db-sync] DATABASE_URL is required.");
  process.exit(1);
}

try {
  if (await tableExists("PolicyDocument")) {
    const hasContent = await columnExists("PolicyDocument", "content");
    const hasTemplate = await columnExists("PolicyDocument", "templateContent");
    const hasPublished = await columnExists("PolicyDocument", "publishedContent");

    if (hasContent && hasTemplate && hasPublished) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "PolicyDocument"
        SET "templateContent" = COALESCE("templateContent", "content"),
            "publishedContent" = COALESCE("publishedContent", "content", "templateContent")
        WHERE "templateContent" IS NULL
           OR "publishedContent" IS NULL
      `);
      console.log(`[db-sync] Backfilled policy snapshot columns for ${updated} rows.`);
    }
  }

  if (await tableExists("Cu12Account")) {
    const hasProvider = await columnExists("Cu12Account", "provider");
    const hasAccountStatus = await columnExists("Cu12Account", "accountStatus");

    if (hasProvider) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "Cu12Account"
        SET "provider" = 'CU12'::"PortalProvider"
        WHERE "provider" IS NULL
      `);
      console.log(`[db-sync] Backfilled provider on ${updated} Cu12Account rows.`);
    }

    if (hasAccountStatus) {
      const updated = await prisma.$executeRawUnsafe(`
        UPDATE "Cu12Account"
        SET "accountStatus" = 'CONNECTED'::"AccountStatus"
        WHERE "accountStatus" IS NULL
      `);
      console.log(`[db-sync] Backfilled accountStatus on ${updated} Cu12Account rows.`);
    }
  }
} finally {
  await prisma.$disconnect();
}
