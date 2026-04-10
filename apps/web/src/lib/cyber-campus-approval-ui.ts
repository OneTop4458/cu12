export interface ApprovalAutoOpenState {
  id: string;
  status: "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";
  methodCount: number;
  selectedMethodKey: string | null;
  requestCode: string | null;
  displayCode: string | null;
  errorMessage: string | null;
}

function buildSelectedMethodKey(input: ApprovalAutoOpenState): string | null {
  return input.selectedMethodKey;
}

export function buildCyberCampusApprovalAutoOpenKey(approval: ApprovalAutoOpenState | null): string | null {
  if (!approval) return null;
  return [
    approval.id,
    approval.status,
    approval.methodCount,
    buildSelectedMethodKey(approval) ?? "",
    approval.requestCode ?? "",
    approval.displayCode ?? "",
    approval.errorMessage ?? "",
  ].join("|");
}

export function shouldAutoOpenCyberCampusApproval(
  previousKey: string | null,
  approval: ApprovalAutoOpenState | null,
): boolean {
  if (!approval) return false;
  if (approval.status === "COMPLETED" || approval.status === "EXPIRED" || approval.status === "CANCELED") {
    return false;
  }
  const nextKey = buildCyberCampusApprovalAutoOpenKey(approval);
  return Boolean(nextKey && nextKey !== previousKey);
}

export function buildCyberCampusApprovalAutoConfirmKey(approval: ApprovalAutoOpenState | null): string | null {
  if (!approval?.selectedMethodKey) return null;
  return [
    approval.id,
    approval.status,
    approval.selectedMethodKey,
    approval.requestCode ?? "",
    approval.displayCode ?? "",
  ].join("|");
}
