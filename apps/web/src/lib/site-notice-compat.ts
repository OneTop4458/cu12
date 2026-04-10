import { Prisma } from "@prisma/client";

let warnedMissingSiteNoticeStore = false;

export function isMissingSiteNoticeStoreError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code !== "P2021" && error.code !== "P2022") {
      return false;
    }
    const target = `${error.message} ${String(error.meta?.modelName ?? "")} ${String(error.meta?.table ?? "")} ${String(error.meta?.column ?? "")}`.toLowerCase();
    return /sitenotice|site_notice|createdbyuserid|displaytarget|visiblefrom|visibleto/.test(target);
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /sitenotice|site_notice/i.test(error.message);
  }

  if (error instanceof Error) {
    return /sitenotice|site_notice/i.test(error.message)
      && /(table|column|does not exist|unknown)/i.test(error.message);
  }

  return false;
}

export function warnMissingSiteNoticeStore() {
  if (warnedMissingSiteNoticeStore) return;
  warnedMissingSiteNoticeStore = true;
  console.warn(
    "[site-notice] DB site notice store is missing. Falling back to empty notices. Run prisma db push.",
  );
}
