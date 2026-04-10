import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCyberCampusApprovalAutoConfirmKey,
  buildCyberCampusApprovalAutoOpenKey,
  shouldAutoOpenCyberCampusApproval,
} from "../src/lib/cyber-campus-approval-ui";

const baseApproval = {
  id: "approval-1",
  status: "PENDING" as const,
  requestedAction: null,
  methodCount: 0,
  selectedMethodKey: null,
  requestCode: null,
  displayCode: null,
  errorMessage: null,
};

test("shouldAutoOpenCyberCampusApproval opens when a polling payload first appears", () => {
  assert.equal(shouldAutoOpenCyberCampusApproval(null, baseApproval), true);
});

test("shouldAutoOpenCyberCampusApproval reopens when approval state materially changes", () => {
  const previousKey = buildCyberCampusApprovalAutoOpenKey(baseApproval);
  const nextApproval = {
    ...baseApproval,
    methodCount: 2,
    selectedMethodKey: "1:DEVICE-1234",
    requestCode: "request-1",
  };

  assert.equal(shouldAutoOpenCyberCampusApproval(previousKey, nextApproval), true);
});

test("buildCyberCampusApprovalAutoConfirmKey stays stable for identical no-code polling state", () => {
  const approval = {
    ...baseApproval,
    status: "ACTIVE" as const,
    requestedAction: "CONFIRM" as const,
    selectedMethodKey: "5:DEVICE-1234",
    requestCode: "request-1",
  };

  assert.equal(
    buildCyberCampusApprovalAutoConfirmKey(approval),
    buildCyberCampusApprovalAutoConfirmKey({ ...approval }),
  );
});

test("buildCyberCampusApprovalAutoOpenKey changes when requestedAction changes", () => {
  const bootstrapKey = buildCyberCampusApprovalAutoOpenKey({
    ...baseApproval,
    requestedAction: "BOOTSTRAP",
  });
  const startKey = buildCyberCampusApprovalAutoOpenKey({
    ...baseApproval,
    requestedAction: "START",
  });

  assert.notEqual(bootstrapKey, startKey);
});
