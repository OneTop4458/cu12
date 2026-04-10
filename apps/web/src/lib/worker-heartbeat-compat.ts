import { Prisma } from "@prisma/client";

let warnedMissingWorkerHeartbeatStore = false;

export function isMissingWorkerHeartbeatStoreError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2021" && error.code !== "P2022") {
      return false;
    }
    const target = `${error.message} ${String(error.meta?.table ?? "")} ${String(error.meta?.column ?? "")}`.toLowerCase();
    return target.includes("workerheartbeat") || target.includes("lastseenat");
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /(workerheartbeat|lastseenat)/i.test(error.message);
  }

  if (error instanceof Error) {
    return /(workerheartbeat|lastseenat)/i.test(error.message)
      && /(table|column|does not exist|unknown)/i.test(error.message);
  }

  return false;
}

export function warnMissingWorkerHeartbeatStore() {
  if (warnedMissingWorkerHeartbeatStore) return;
  warnedMissingWorkerHeartbeatStore = true;
  console.warn(
    "[queue] DB workerHeartbeat store is missing. Falling back to queue timestamps without heartbeat freshness. Run prisma db push.",
  );
}
