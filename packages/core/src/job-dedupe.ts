const ACTIVE_JOB_DEDUPE_SEPARATOR = "\u001f";
const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

export interface ActiveJobDedupeInput {
  userId: string;
  type: string;
  status: string;
  idempotencyKey?: string | null;
}

export interface InsertActiveJobOptions<T> {
  activeDedupeKey: string | null;
  insert: () => Promise<T>;
  findActive: (activeDedupeKey: string) => Promise<T | null>;
  isActiveDedupeConflict: (error: unknown) => boolean;
}

export function buildActiveJobDedupeKey(input: ActiveJobDedupeInput): string | null {
  if (!ACTIVE_JOB_STATUSES.has(input.status) || !input.idempotencyKey) {
    return null;
  }

  return ["v1", input.userId, input.type, input.idempotencyKey].join(ACTIVE_JOB_DEDUPE_SEPARATOR);
}

export function isActiveJobDedupeConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown; constraint?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target ?? candidate.meta?.constraint;
  return JSON.stringify(target ?? "").toLowerCase().includes("activededupekey");
}

export async function insertActiveJobOrGetExisting<T>(
  options: InsertActiveJobOptions<T>,
): Promise<{ job: T; deduplicated: boolean }> {
  if (!options.activeDedupeKey) {
    return { job: await options.insert(), deduplicated: false };
  }

  let lastConflict: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return { job: await options.insert(), deduplicated: false };
    } catch (error) {
      if (!options.isActiveDedupeConflict(error)) {
        throw error;
      }
      lastConflict = error;
      const existing = await options.findActive(options.activeDedupeKey);
      if (existing) {
        return { job: existing, deduplicated: true };
      }
    }
  }

  throw lastConflict;
}
