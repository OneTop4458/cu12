import type { PortalProvider } from "@cu12/core";
import { Prisma } from "@prisma/client";

let warnedMissingProviderColumn = false;

function getErrorColumn(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const record = meta as Record<string, unknown>;
  const column = record.column;
  return typeof column === "string" ? column.toLowerCase() : "";
}

export function isMissingProviderColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2022") return false;

    const column = getErrorColumn(error.meta);
    if (column.includes("provider")) return true;

    return error.message.toLowerCase().includes("provider");
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.toLowerCase().includes("provider");
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return error.message.toLowerCase().includes("provider")
      && /(unknown field|unknown argument)/i.test(error.message);
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("provider")
      && /(column|does not exist|unknown column|unknown field|unknown argument)/i.test(error.message);
  }

  return false;
}

export function warnMissingProviderColumn() {
  if (warnedMissingProviderColumn) return;
  warnedMissingProviderColumn = true;
  console.warn(
    "[portal] DB provider columns are missing. Falling back to CU12-only compatibility mode. Run prisma db push.",
  );
}

export function withDefaultProvider<T extends { provider: PortalProvider }>(
  record: Omit<T, "provider">,
): T {
  return {
    ...record,
    provider: "CU12",
  } as T;
}
