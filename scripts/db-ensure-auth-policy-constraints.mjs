import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    `"${tableName}"`,
  );
  return rows[0]?.exists === true;
}

async function constraintExists(constraintName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = $1
    ) AS "exists"`,
    constraintName,
  );
  return rows[0]?.exists === true;
}

async function duplicateCount(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  return Number(rows[0]?.count ?? 0);
}

async function duplicateSamples(sql) {
  return prisma.$queryRawUnsafe(sql);
}

async function ensureUniqueConstraint(config) {
  const hasTable = await tableExists(config.table);
  if (!hasTable) {
    console.log(`[db-sync] Table ${config.table} does not exist yet. Skipping ${config.constraint}.`);
    return;
  }

  const existing = await constraintExists(config.constraint);
  if (existing) {
    console.log(`[db-sync] Constraint ${config.constraint} already exists.`);
    return;
  }

  const duplicates = await duplicateCount(config.duplicateCountSql);
  if (duplicates > 0) {
    console.error(`[db-sync] Cannot add ${config.constraint}. Found ${duplicates} duplicate key groups in ${config.table}.`);
    const samples = await duplicateSamples(config.sampleSql);
    console.error(JSON.stringify(samples, null, 2));
    process.exitCode = 1;
    return;
  }

  await prisma.$executeRawUnsafe(config.addSql);
  console.log(`[db-sync] Added ${config.constraint}.`);
}

if (!process.env.DATABASE_URL) {
  console.error("[db-sync] DATABASE_URL is required.");
  process.exit(1);
}

try {
  await ensureUniqueConstraint({
    table: "PolicyDocument",
    constraint: "PolicyDocument_type_version_key",
    duplicateCountSql: `
      SELECT COUNT(*)::int AS "count"
      FROM (
        SELECT "type", "version"
        FROM "PolicyDocument"
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    sampleSql: `
      SELECT "type", "version", COUNT(*)::int AS "rowCount"
      FROM "PolicyDocument"
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
      ORDER BY "type" ASC, "version" ASC
      LIMIT 20
    `,
    addSql: `
      ALTER TABLE "PolicyDocument"
      ADD CONSTRAINT "PolicyDocument_type_version_key" UNIQUE ("type", "version")
    `,
  });

  await ensureUniqueConstraint({
    table: "UserPolicyConsent",
    constraint: "UserPolicyConsent_userId_policyType_policyVersion_key",
    duplicateCountSql: `
      SELECT COUNT(*)::int AS "count"
      FROM (
        SELECT "userId", "policyType", "policyVersion"
        FROM "UserPolicyConsent"
        GROUP BY 1, 2, 3
        HAVING COUNT(*) > 1
      ) duplicates
    `,
    sampleSql: `
      SELECT "userId", "policyType", "policyVersion", COUNT(*)::int AS "rowCount"
      FROM "UserPolicyConsent"
      GROUP BY 1, 2, 3
      HAVING COUNT(*) > 1
      ORDER BY "userId" ASC, "policyType" ASC, "policyVersion" ASC
      LIMIT 20
    `,
    addSql: `
      ALTER TABLE "UserPolicyConsent"
      ADD CONSTRAINT "UserPolicyConsent_userId_policyType_policyVersion_key"
      UNIQUE ("userId", "policyType", "policyVersion")
    `,
  });

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
} finally {
  await prisma.$disconnect();
}
