import { Prisma } from "@prisma/client";

type WithIsTestUser = {
  isTestUser: boolean;
};

type WithoutIsTestUser<T extends WithIsTestUser> = Omit<T, "isTestUser">;

let warnedMissingIsTestUser = false;

function getErrorColumn(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const record = meta as Record<string, unknown>;
  const column = record.column;
  return typeof column === "string" ? column.toLowerCase() : "";
}

export function isMissingIsTestUserColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2022") return false;
    const column = getErrorColumn(error.meta);
    if (column.includes("istestuser")) return true;
    return /istestuser/i.test(error.message);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /istestuser/i.test(error.message);
  }

  if (error instanceof Error) {
    return /istestuser/i.test(error.message)
      && /(column|does not exist|unknown column)/i.test(error.message);
  }

  return false;
}

function warnMissingIsTestUserColumn() {
  if (warnedMissingIsTestUser) return;
  warnedMissingIsTestUser = true;
  console.warn(
    "[auth] DB column user.isTestUser is missing. Falling back to legacy non-test-user checks. Run prisma db push.",
  );
}

export async function withIsTestUserFallback<T extends WithIsTestUser>(
  queryWithIsTestUser: () => Promise<T | null>,
  legacyQuery: () => Promise<WithoutIsTestUser<T> | null>,
): Promise<T | null> {
  try {
    return await queryWithIsTestUser();
  } catch (error) {
    if (!isMissingIsTestUserColumnError(error)) {
      throw error;
    }

    warnMissingIsTestUserColumn();
    const legacy = await legacyQuery();
    return legacy ? { ...legacy, isTestUser: false } as T : null;
  }
}
