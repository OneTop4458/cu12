import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('"JobQueue"') IS NOT NULL AS "exists"`,
  );
  return rows[0]?.exists === true;
}

async function columnExists() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'JobQueue'
        AND column_name = 'activeDedupeKey'
    ) AS "exists"
  `);
  return rows[0]?.exists === true;
}

function count(rows) {
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!await tableExists()) {
    console.log(JSON.stringify({
      activeRowsBefore: 0,
      duplicateRowsCanceled: 0,
      terminalKeysCleared: 0,
      activeKeysBackfilled: 0,
      remainingUnkeyedActiveRows: 0,
      remainingDuplicateGroups: 0,
      skipped: "JOB_QUEUE_NOT_CREATED",
    }));
    return;
  }
  if (!await columnExists()) {
    throw new Error("JobQueue.activeDedupeKey is missing. Run prisma db push before this backfill.");
  }

  const summary = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE "JobQueue" IN ACCESS EXCLUSIVE MODE`);

    const activeRowsBefore = count(await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM "JobQueue"
      WHERE "status"::text IN ('PENDING', 'RUNNING')
        AND "idempotencyKey" IS NOT NULL
    `));

    const duplicateRowsCanceled = count(await tx.$queryRawUnsafe(`
      WITH ranked AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "userId", "type", "idempotencyKey"
            ORDER BY
              CASE WHEN "status"::text = 'RUNNING' THEN 0 ELSE 1 END,
              "createdAt" ASC,
              "id" ASC
          ) AS "rank"
        FROM "JobQueue"
        WHERE "status"::text IN ('PENDING', 'RUNNING')
          AND "idempotencyKey" IS NOT NULL
      ), canceled AS (
        UPDATE "JobQueue" AS job
        SET
          "status" = 'CANCELED',
          "activeDedupeKey" = NULL,
          "startedAt" = NULL,
          "workerId" = NULL,
          "finishedAt" = NOW(),
          "lastError" = 'ACTIVE_DEDUPE_BACKFILL_DUPLICATE',
          "updatedAt" = NOW()
        FROM ranked
        WHERE job."id" = ranked."id"
          AND ranked."rank" > 1
        RETURNING 1
      )
      SELECT COUNT(*)::int AS "count" FROM canceled
    `));

    const terminalKeysCleared = count(await tx.$queryRawUnsafe(`
      WITH cleared AS (
        UPDATE "JobQueue"
        SET "activeDedupeKey" = NULL, "updatedAt" = NOW()
        WHERE "status"::text NOT IN ('PENDING', 'RUNNING')
          AND "activeDedupeKey" IS NOT NULL
        RETURNING 1
      )
      SELECT COUNT(*)::int AS "count" FROM cleared
    `));

    const activeKeysBackfilled = count(await tx.$queryRawUnsafe(`
      WITH backfilled AS (
        UPDATE "JobQueue"
        SET
          "activeDedupeKey" = concat(
            'v1', chr(31), "userId", chr(31), "type"::text, chr(31), "idempotencyKey"
          ),
          "updatedAt" = NOW()
        WHERE "status"::text IN ('PENDING', 'RUNNING')
          AND "idempotencyKey" IS NOT NULL
          AND "activeDedupeKey" IS DISTINCT FROM concat(
            'v1', chr(31), "userId", chr(31), "type"::text, chr(31), "idempotencyKey"
          )
        RETURNING 1
      )
      SELECT COUNT(*)::int AS "count" FROM backfilled
    `));

    const remainingDuplicateGroups = count(await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM (
        SELECT "activeDedupeKey"
        FROM "JobQueue"
        WHERE "activeDedupeKey" IS NOT NULL
        GROUP BY "activeDedupeKey"
        HAVING COUNT(*) > 1
      ) duplicates
    `));
    const remainingUnkeyedActiveRows = count(await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "count"
      FROM "JobQueue"
      WHERE "status"::text IN ('PENDING', 'RUNNING')
        AND "idempotencyKey" IS NOT NULL
        AND "activeDedupeKey" IS NULL
    `));
    if (remainingDuplicateGroups > 0 || remainingUnkeyedActiveRows > 0) {
      throw new Error("Active job dedupe backfill verification failed.");
    }

    return {
      activeRowsBefore,
      duplicateRowsCanceled,
      terminalKeysCleared,
      activeKeysBackfilled,
      remainingUnkeyedActiveRows,
      remainingDuplicateGroups,
    };
  }, {
    maxWait: 10_000,
    timeout: 120_000,
  });

  console.log(JSON.stringify(summary));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
