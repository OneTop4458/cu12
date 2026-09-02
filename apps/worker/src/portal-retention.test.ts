import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_PORTAL_APPROVAL_STATUSES,
  buildPortalApprovalTerminalScrub,
  TERMINAL_PORTAL_APPROVAL_STATUSES,
} from "@cu12/core";
import {
  buildExpiredPortalApprovalWhere,
  buildExpiredPortalSessionWhere,
  buildRetentionCutoffs,
  PORTAL_APPROVAL_RETENTION_DAYS,
} from "./retention-policy";

test("completed, canceled, and expired approvals receive the same sensitive-field scrub", () => {
  for (const status of TERMINAL_PORTAL_APPROVAL_STATUSES) {
    assert.deepEqual(buildPortalApprovalTerminalScrub(status), {
      cookieState: [],
      methods: null,
      requestedAction: null,
      pendingCode: null,
      selectedWay: null,
      selectedParam: null,
      selectedTarget: null,
      authSeq: null,
      requestCode: null,
      displayCode: null,
      errorMessage: null,
      workerLeaseId: null,
      workerHeartbeatAt: null,
      restartRequired: false,
    });
  }

  for (const status of ACTIVE_PORTAL_APPROVAL_STATUSES) {
    assert.equal(buildPortalApprovalTerminalScrub(status), null);
  }
});

test("portal retention uses one injected clock and protects boundary approval rows", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const cutoff = new Date("2026-08-03T12:00:00.000Z");
  const cutoffs = buildRetentionCutoffs(now);
  const approvalWhere = buildExpiredPortalApprovalWhere(now);

  assert.equal(PORTAL_APPROVAL_RETENTION_DAYS, 30);
  assert.deepEqual(cutoffs.portalApproval, cutoff);
  assert.deepEqual(approvalWhere.status.in, ["COMPLETED", "EXPIRED", "CANCELED"]);
  assert.equal(approvalWhere.status.in.includes("PENDING" as never), false);
  assert.equal(approvalWhere.status.in.includes("ACTIVE" as never), false);
  assert.deepEqual(approvalWhere.updatedAt, { lt: cutoff });
});

test("portal session cleanup removes only unusable or expired cookie state", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const where = buildExpiredPortalSessionWhere(now);

  assert.deepEqual(where, {
    OR: [
      { status: { in: ["EXPIRED", "INVALID"] } },
      { expiresAt: { lte: now } },
    ],
  });
  assert.equal(where.OR[0]?.status?.in.includes("ACTIVE" as never), false);
  assert.deepEqual(where.OR[1]?.expiresAt, { lte: now });
});
