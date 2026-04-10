import { Prisma } from "@prisma/client";

let warnedMissingMailSubscriptionStore = false;

export function isMissingMailSubscriptionStoreError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2021" && error.code !== "P2022") {
      return false;
    }
    const target = `${error.message} ${String(error.meta?.modelName ?? "")} ${String(error.meta?.table ?? "")} ${String(error.meta?.column ?? "")}`.toLowerCase();
    return /mailsubscription|mail_subscription|alertonautolearn|digestenabled|digesthour/.test(target);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /mailsubscription|mail_subscription/i.test(error.message);
  }

  if (error instanceof Error) {
    return /mailsubscription|mail_subscription/i.test(error.message)
      && /(table|column|does not exist|unknown)/i.test(error.message);
  }

  return false;
}

export function warnMissingMailSubscriptionStore() {
  if (warnedMissingMailSubscriptionStore) return;
  warnedMissingMailSubscriptionStore = true;
  console.warn(
    "[mail] DB mail subscription store is missing. Falling back to account-derived defaults. Run prisma db push.",
  );
}
