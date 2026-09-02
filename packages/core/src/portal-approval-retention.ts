export const ACTIVE_PORTAL_APPROVAL_STATUSES = ["PENDING", "ACTIVE"] as const;
export const TERMINAL_PORTAL_APPROVAL_STATUSES = ["COMPLETED", "EXPIRED", "CANCELED"] as const;

export type PortalApprovalStatus =
  | (typeof ACTIVE_PORTAL_APPROVAL_STATUSES)[number]
  | (typeof TERMINAL_PORTAL_APPROVAL_STATUSES)[number];

export function buildPortalApprovalTerminalScrub(status: PortalApprovalStatus | undefined) {
  if (!status || !TERMINAL_PORTAL_APPROVAL_STATUSES.includes(
    status as (typeof TERMINAL_PORTAL_APPROVAL_STATUSES)[number],
  )) {
    return null;
  }

  return {
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
  };
}
