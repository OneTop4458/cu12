import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_DEDUPE_INDEX_NAME,
  isExpectedActiveDedupeIndex,
  parseRolloutMode,
  runActiveJobDedupeRollout,
} from "../../scripts/db-backfill-active-job-dedupe.mjs";

function expectedIndex(overrides = {}) {
  return {
    name: ACTIVE_DEDUPE_INDEX_NAME,
    method: "btree",
    isUnique: true,
    isValid: true,
    hasPredicate: false,
    hasExpressions: false,
    columns: ["activeDedupeKey"],
    definition: 'CREATE UNIQUE INDEX "JobQueue_activeDedupeKey_key" ON public."JobQueue" USING btree ("activeDedupeKey")',
    ...overrides,
  };
}

function createMockClient(options = {}) {
  let columnReady = options.columnReady ?? false;
  let index = options.index ?? null;
  const executed = [];
  const queried = [];
  const operations = [];
  const counts = {
    activeRowsBefore: options.activeRowsBefore ?? 0,
    duplicateRowsCanceled: options.duplicateRowsCanceled ?? 0,
    terminalKeysCleared: options.terminalKeysCleared ?? 0,
    activeKeysBackfilled: options.activeKeysBackfilled ?? 0,
    remainingDuplicateGroups: options.remainingDuplicateGroups ?? 0,
    remainingUnkeyedActiveRows: options.remainingUnkeyedActiveRows ?? 0,
  };

  const tx = {
    async $executeRawUnsafe(sql) {
      executed.push(sql);
      operations.push(sql);
      if (sql.includes("ADD COLUMN IF NOT EXISTS")) columnReady = true;
      if (sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS") && !index) index = expectedIndex();
      return 0;
    },
    async $queryRawUnsafe(sql) {
      queried.push(sql);
      operations.push(sql);
      if (sql.includes("information_schema.columns")) return [{ exists: columnReady }];
      if (sql.includes("FROM pg_class AS table_class")) return index ? [index] : [];
      if (sql.includes("FROM canceled")) return [{ count: counts.duplicateRowsCanceled }];
      if (sql.includes("FROM cleared")) return [{ count: counts.terminalKeysCleared }];
      if (sql.includes("FROM backfilled")) return [{ count: counts.activeKeysBackfilled }];
      if (sql.includes(") duplicates")) return [{ count: counts.remainingDuplicateGroups }];
      if (sql.includes('"activeDedupeKey" IS NULL')) return [{ count: counts.remainingUnkeyedActiveRows }];
      if (sql.includes("COUNT(*)::int")) return [{ count: counts.activeRowsBefore }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const client = {
    async $queryRawUnsafe(sql) {
      if (sql.includes("to_regclass")) return [{ exists: options.tableExists ?? true }];
      throw new Error(`Unexpected root query: ${sql}`);
    },
    async $transaction(work) {
      return work(tx);
    },
  };
  return { client, executed, queried, operations };
}

test("prepare handles an existing populated database before creating the exact unique index", async () => {
  const mock = createMockClient({
    tableExists: true,
    columnReady: false,
    activeRowsBefore: 3,
    duplicateRowsCanceled: 2,
    activeKeysBackfilled: 1,
  });

  const summary = await runActiveJobDedupeRollout(mock.client, "prepare");

  assert.deepEqual(summary, {
    mode: "prepare",
    activeRowsBefore: 3,
    duplicateRowsCanceled: 2,
    terminalKeysCleared: 0,
    activeKeysBackfilled: 1,
    remainingUnkeyedActiveRows: 0,
    remainingDuplicateGroups: 0,
    indexReady: true,
    skipped: null,
  });
  assert.ok(mock.executed.some((sql) => sql.includes("ADD COLUMN IF NOT EXISTS")));
  assert.ok(mock.executed.some((sql) => sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS")));
  assert.ok(mock.operations.findIndex((sql) => sql.includes("FROM canceled"))
    < mock.operations.findIndex((sql) => sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS")));
});

test("prepare is a safe no-op for a fresh database without JobQueue", async () => {
  const mock = createMockClient({ tableExists: false });

  const summary = await runActiveJobDedupeRollout(mock.client, "prepare");

  assert.equal(summary.skipped, "JOB_QUEUE_NOT_CREATED");
  assert.equal(summary.indexReady, false);
  assert.deepEqual(mock.executed, []);
  assert.deepEqual(mock.queried, []);
});

test("already prepared databases remain idempotent", async () => {
  const mock = createMockClient({ columnReady: true, index: expectedIndex() });

  const first = await runActiveJobDedupeRollout(mock.client, "prepare");
  const second = await runActiveJobDedupeRollout(mock.client, "finalize");

  assert.equal(first.indexReady, true);
  assert.equal(second.indexReady, true);
  assert.equal(first.duplicateRowsCanceled, 0);
  assert.equal(second.activeKeysBackfilled, 0);
});

test("an existing index with the expected name but wrong definition fails without replacement", async () => {
  const mock = createMockClient({
    columnReady: true,
    index: expectedIndex({ isUnique: false }),
  });

  await assert.rejects(
    () => runActiveJobDedupeRollout(mock.client, "finalize"),
    /exists with an unexpected definition/,
  );
  assert.equal(mock.executed.some((sql) => sql.includes("CREATE UNIQUE INDEX")), false);
  assert.equal(mock.queried.some((sql) => sql.includes("FROM canceled")), false);
});

test("index validation and mode parsing are strict", () => {
  assert.equal(isExpectedActiveDedupeIndex(expectedIndex()), true);
  assert.equal(isExpectedActiveDedupeIndex(expectedIndex({ columns: ["id"] })), false);
  assert.equal(parseRolloutMode([]), "finalize");
  assert.equal(parseRolloutMode(["--mode=prepare"]), "prepare");
  assert.throws(() => parseRolloutMode(["--mode=unsafe"]), /Unsupported/);
});
