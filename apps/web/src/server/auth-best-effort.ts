import { writeAuditLog, type WriteAuditLogInput } from "./audit-log";

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

export function writeAuditLogBestEffort(input: WriteAuditLogInput): Promise<void> {
  return bestEffortVoid(() => writeAuditLog(input));
}
