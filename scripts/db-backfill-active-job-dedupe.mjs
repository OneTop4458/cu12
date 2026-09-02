import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const ACTIVE_DEDUPE_INDEX_NAME = "JobQueue_activeDedupeKey_key";
const ROLLOUT_MODES = new Set(["prepare", "finalize"]);

function count(rows) {
  return Number(rows[0]?.count ?? 0);
}

export function parseRolloutMode(args) {
  const raw = args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "finalize";
  if (!ROLLOUT_MODES.has(raw)) {
    throw new Error(`Unsupported active job dedupe rollout mode: ${raw}`);
  }
  return raw;
}

export function isExpectedActiveDedupeIndex(row) {
  return Boolean(
    row
    && row.name === ACTIVE_DEDUPE_INDEX_NAME
    && row.method === "btree"
    && row.isUnique === true
    && row.isValid === true
    && row.hasPredicate === false
    && row.hasExpressions === false
    && Array.isArray(row.columns)
    && row.columns.length === 1
    && row.columns[0] === "activeDedupeKey"
    && typeof row.definition === "string"
    && /^CREATE UNIQUE INDEX "JobQueue_activeDedupeKey_key" ON .+ USING btree \("activeDedupeKey"\)$/.test(row.definition)
  );
}

async function tableExists(client) {
  const rows = await client.$queryRawUnsafe(
    `SELECT to_regclass('"JobQueue"') IS NOT NULL AS "exists"`,
  );
  return rows[0]?.exists === true;
}

async function columnExists(client) {
  const rows = await client.$queryRawUnsafe(`
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

async function readExpectedIndex(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT
      index_class.relname AS "name",
      access_method.amname AS "method",
      index_meta.indisunique AS "isUnique",
      index_meta.indisvalid AS "isValid",
      index_meta.indpred IS NOT NULL AS "hasPredicate",
      index_meta.indexprs IS NOT NULL AS "hasExpressions",
      pg_get_indexdef(index_meta.indexrelid) AS "definition",
      ARRAY(
        SELECT attribute.attname
        FROM unnest(index_meta.indkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = table_class.oid
          AND attribute.attnum = key_column.attnum
        ORDER BY key_column.ordinality
      ) AS "columns"
    FROM pg_class AS table_class
    JOIN pg_namespace AS namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_index AS index_meta
      ON index_meta.indrelid = table_class.oid
    JOIN pg_class AS index_class
      ON index_class.oid = index_meta.indexrelid
    JOIN pg_am AS access_method
      ON access_method.oid = index_class.relam
    WHERE namespace.nspname = current_schema()
      AND table_class.relname = 'JobQueue'
      AND index_class.relname = '${ACTIVE_DEDUPE_INDEX_NAME}'
  `);
  return rows[0] ?? null;
}

async function requireExpectedIndexOrMissing(client) {
  const index = await readExpectedIndex(client);
  if (index && !isExpectedActiveDedupeIndex(index)) {
    throw new Error(`${ACTIVE_DEDUPE_INDEX_NAME} exists with an unexpected definition.`);
  }
  return index;
}

function emptySummary(mode, skipped) {
  return {
    mode,
    activeRowsBefore: 0,
    duplicateRowsCanceled: 0,
    terminalKeysCleared: 0,
    activeKeysBackfilled: 0,
    remainingUnkeyedActiveRows: 0,
    remainingDuplicateGroups: 0,
    indexReady: false,
    skipped,
  };
}

export async function runActiveJobDedupeRollout(client, mode) {
  if (!ROLLOUT_MODES.has(mode)) {
    throw new Error(`Unsupported active job dedupe rollout mode: ${mode}`);
  }
  if (!await tableExists(client)) {
    return emptySummary(mode, "JOB_QUEUE_NOT_CREATED");
  }

  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE "JobQueue" IN ACCESS EXCLUSIVE MODE`);
    if (mode === "prepare") {
      await tx.$executeRawUnsafe(`
        ALTER TABLE "JobQueue"
        ADD COLUMN IF NOT EXISTS "activeDedupeKey" TEXT
      `);
    }
    if (!await columnExists(tx)) {
      throw new Error("JobQueue.activeDedupeKey is missing. Run prepare before finalize.");
    }

    await requireExpectedIndexOrMissing(tx);

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

    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "${ACTIVE_DEDUPE_INDEX_NAME}"
      ON "JobQueue" ("activeDedupeKey")
    `);
    const index = await requireExpectedIndexOrMissing(tx);
    if (!index) {
      throw new Error(`${ACTIVE_DEDUPE_INDEX_NAME} was not created.`);
    }

    return {
      mode,
      activeRowsBefore,
      duplicateRowsCanceled,
      terminalKeysCleared,
      activeKeysBackfilled,
      remainingUnkeyedActiveRows,
      remainingDuplicateGroups,
      indexReady: true,
      skipped: null,
    };
  }, {
    maxWait: 10_000,
    timeout: 120_000,
  });
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(path.resolve(entry)).href);
}

if (isMainModule()) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  const prisma = new PrismaClient();
  try {
    const summary = await runActiveJobDedupeRollout(prisma, parseRolloutMode(process.argv.slice(2)));
    console.log(JSON.stringify(summary));
  } finally {
    await prisma.$disconnect();
  }
}
