import { writeAuditLog, type WriteAuditLogInput } from "./audit-log";
import {
  checkAuthThrottle,
  clearAuthFailures,
  recordAuthFailure,
  type AuthScope,
  type AuthThrottleStatus,
} from "./auth-rate-limit";

const UNBLOCKED_THROTTLE: AuthThrottleStatus = {
  blocked: false,
  retryAfterSeconds: 0,
};

export async function bestEffort<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export async function bestEffortVoid(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    // Ignore persistence failures so auth flow stays available.
  }
}

export function checkAuthThrottleBestEffort(
  scope: AuthScope,
  identifiers: Array<string | null | undefined>,
): Promise<AuthThrottleStatus> {
  return bestEffort(() => checkAuthThrottle(scope, identifiers), UNBLOCKED_THROTTLE);
}

export function recordAuthFailureBestEffort(
  scope: AuthScope,
  identifiers: Array<string | null | undefined>,
): Promise<AuthThrottleStatus> {
  return bestEffort(() => recordAuthFailure(scope, identifiers), UNBLOCKED_THROTTLE);
}

export function clearAuthFailuresBestEffort(
  scope: AuthScope,
  identifiers: Array<string | null | undefined>,
): Promise<void> {
  return bestEffortVoid(() => clearAuthFailures(scope, identifiers));
}

export function writeAuditLogBestEffort(input: WriteAuditLogInput): Promise<void> {
  return bestEffortVoid(() => writeAuditLog(input));
}
