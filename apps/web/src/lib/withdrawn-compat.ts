import { Prisma } from "@prisma/client";

type WithWithdrawnAt = {
  withdrawnAt: Date | null;
};

type WithoutWithdrawnAt<T extends WithWithdrawnAt> = Omit<T, "withdrawnAt">;

let warnedMissingWithdrawnAt = false;

function getErrorColumn(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const record = meta as Record<string, unknown>;
  const column = record.column;
  return typeof column === "string" ? column.toLowerCase() : "";
}

export function isMissingWithdrawnAtColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2022") return false;

    const column = getErrorColumn(error.meta);
    if (column.includes("withdrawnat")) return true;

    return error.message.toLowerCase().includes("withdrawnat");
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.toLowerCase().includes("withdrawnat");
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("withdrawnat")
      && /(column|does not exist|unknown column)/i.test(error.message);
  }

  return false;
}

function warnMissingWithdrawnAtColumn() {
  if (warnedMissingWithdrawnAt) return;
  warnedMissingWithdrawnAt = true;
  console.warn(
    "[auth] DB column user.withdrawnAt is missing. Falling back to legacy active-user checks. Run prisma db push.",
  );
}

export async function withWithdrawnAtFallback<T extends WithWithdrawnAt>(
  queryWithWithdrawnAt: () => Promise<T | null>,
  legacyQuery: () => Promise<WithoutWithdrawnAt<T> | null>,
): Promise<T | null> {
  try {
    return await queryWithWithdrawnAt();
  } catch (error) {
    if (!isMissingWithdrawnAtColumnError(error)) {
      throw error;
    }

    warnMissingWithdrawnAtColumn();
    const legacy = await legacyQuery();
    return legacy ? { ...legacy, withdrawnAt: null } as T : null;
  }
}
