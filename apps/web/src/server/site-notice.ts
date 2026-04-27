import { Prisma, SiteNoticeType } from "@prisma/client";
import type { SiteNoticeDisplayTarget } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  normalizeSiteNoticeDisplayTarget,
  type SiteNoticeSurface,
} from "@/lib/site-notice-display";
import {
  isMissingSiteNoticeStoreError,
  warnMissingSiteNoticeStore,
} from "@/lib/site-notice-compat";

export type SiteNoticePayload = {
  id: string;
  title: string;
  message: string;
  type: SiteNoticeType;
  displayTarget: SiteNoticeDisplayTarget;
  isActive: boolean;
  createdByUser: {
    id: string;
    email: string;
  } | null;
  priority: number;
  visibleFrom: string | null;
  visibleTo: string | null;
  createdAt: string;
  updatedAt: string;
};

type SiteNoticeQueryOptions = {
  includeInactive?: boolean;
  now?: Date;
  surface?: SiteNoticeSurface;
};

type SiteNoticeModel = Prisma.SiteNoticeGetPayload<{
  include: {
    createdByUser: {
      select: {
        id: true;
        email: true;
      };
    };
  };
}>;

type PublicSiteNoticeRecord = {
  id: string;
  title: string;
  message: string;
  type: SiteNoticeType;
  displayTarget: SiteNoticeDisplayTarget;
  isActive: boolean;
  priority: number;
  visibleFrom: Date | null;
  visibleTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const PUBLIC_SITE_NOTICES_TAG = "public-site-notices";

export type PublicSiteNoticePayload = Omit<SiteNoticePayload, "createdByUser">;

const SITE_NOTICE_DISPLAY_TARGET = {
  LOGIN: "LOGIN",
  TOPBAR: "TOPBAR",
  BOTH: "BOTH",
} as const satisfies Record<"LOGIN" | "TOPBAR" | "BOTH", SiteNoticeDisplayTarget>;

function toNullableIso(value: Date | null): string | null {
  if (!value) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function buildSurfaceWhere(type?: SiteNoticeType, surface?: SiteNoticeSurface): Prisma.SiteNoticeWhereInput {
  if (!surface) {
    return type ? { type } : {};
  }

  if (surface === "LOGIN") {
    if (type === SiteNoticeType.MAINTENANCE) {
      return { type: SiteNoticeType.MAINTENANCE };
    }

    if (type === SiteNoticeType.BROADCAST) {
      return {
        type: SiteNoticeType.BROADCAST,
        displayTarget: {
          in: [SITE_NOTICE_DISPLAY_TARGET.LOGIN, SITE_NOTICE_DISPLAY_TARGET.BOTH],
        },
      };
    }

    return {
      OR: [
        { type: SiteNoticeType.MAINTENANCE },
        {
          type: SiteNoticeType.BROADCAST,
          displayTarget: {
            in: [SITE_NOTICE_DISPLAY_TARGET.LOGIN, SITE_NOTICE_DISPLAY_TARGET.BOTH],
          },
        },
      ],
    };
  }

  if (type === SiteNoticeType.MAINTENANCE) {
    return { type: SiteNoticeType.MAINTENANCE };
  }

  if (type === SiteNoticeType.BROADCAST) {
    return {
      type: SiteNoticeType.BROADCAST,
      displayTarget: {
        in: [SITE_NOTICE_DISPLAY_TARGET.TOPBAR, SITE_NOTICE_DISPLAY_TARGET.BOTH],
      },
    };
  }

  return {
    OR: [
      { type: SiteNoticeType.MAINTENANCE },
      {
        type: SiteNoticeType.BROADCAST,
        displayTarget: {
          in: [SITE_NOTICE_DISPLAY_TARGET.TOPBAR, SITE_NOTICE_DISPLAY_TARGET.BOTH],
        },
      },
    ],
  };
}

function buildBaseWhere(type?: SiteNoticeType, options?: SiteNoticeQueryOptions): Prisma.SiteNoticeWhereInput {
  const includeInactive = options?.includeInactive ?? false;
  const now = options?.now ?? new Date();
  const clauses: Prisma.SiteNoticeWhereInput[] = [buildSurfaceWhere(type, options?.surface)];

  if (!includeInactive) {
    clauses.push(
      { isActive: true },
      {
        OR: [
          { visibleFrom: null },
          { visibleFrom: { lte: now } },
        ],
      },
      {
        OR: [
          { visibleTo: null },
          { visibleTo: { gte: now } },
        ],
      },
    );
  }

  return clauses.length === 1
    ? clauses[0] ?? {}
    : { AND: clauses };
}

function toDisplayTarget(
  type: SiteNoticeType,
  displayTarget: SiteNoticeDisplayTarget | null | undefined,
): SiteNoticeDisplayTarget {
  return normalizeSiteNoticeDisplayTarget(type, displayTarget) as SiteNoticeDisplayTarget;
}

function toSiteNoticePayload(record: SiteNoticeModel): SiteNoticePayload {
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    type: record.type,
    displayTarget: toDisplayTarget(record.type, record.displayTarget),
    isActive: record.isActive,
    createdByUser: record.createdByUser
      ? {
        id: record.createdByUser.id,
        email: record.createdByUser.email,
      }
      : null,
    priority: record.priority,
    visibleFrom: toNullableIso(record.visibleFrom),
    visibleTo: toNullableIso(record.visibleTo),
    createdAt: toNullableIso(record.createdAt) ?? "",
    updatedAt: toNullableIso(record.updatedAt) ?? "",
  };
}

function toPublicSiteNoticePayload(record: PublicSiteNoticeRecord): PublicSiteNoticePayload {
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    type: record.type,
    displayTarget: toDisplayTarget(record.type, record.displayTarget),
    isActive: record.isActive,
    priority: record.priority,
    visibleFrom: toNullableIso(record.visibleFrom),
    visibleTo: toNullableIso(record.visibleTo),
    createdAt: toNullableIso(record.createdAt) ?? "",
    updatedAt: toNullableIso(record.updatedAt) ?? "",
  };
}

export async function listSiteNotices(
  type?: SiteNoticeType,
  includeInactive = false,
  surface?: SiteNoticeSurface,
) {
  const now = new Date();
  let records: SiteNoticeModel[];
  try {
    records = await prisma.siteNotice.findMany({
      where: buildBaseWhere(type, { includeInactive, now, surface }),
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      include: {
        createdByUser: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  } catch (error) {
    if (!isMissingSiteNoticeStoreError(error)) {
      throw error;
    }
    warnMissingSiteNoticeStore();
    return [];
  }

  return records.map(toSiteNoticePayload);
}

const listPublicSiteNoticesCached = unstable_cache(
  async (type: SiteNoticeType | null, surface: SiteNoticeSurface | null) => {
    if (!process.env.DATABASE_URL) {
      return [] satisfies PublicSiteNoticePayload[];
    }

    const now = new Date();
    let records: PublicSiteNoticeRecord[];
    try {
      records = await prisma.siteNotice.findMany({
        where: buildBaseWhere(type ?? undefined, {
          includeInactive: false,
          now,
          surface: surface ?? undefined,
        }),
        orderBy: [
          { priority: "desc" },
          { createdAt: "desc" },
        ],
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          displayTarget: true,
          isActive: true,
          priority: true,
          visibleFrom: true,
          visibleTo: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (!isMissingSiteNoticeStoreError(error)) {
        throw error;
      }
      warnMissingSiteNoticeStore();
      return [] satisfies PublicSiteNoticePayload[];
    }

    return records.map(toPublicSiteNoticePayload);
  },
  ["public-site-notices"],
  {
    revalidate: 60,
    tags: [PUBLIC_SITE_NOTICES_TAG],
  },
);

export async function listPublicSiteNotices(
  type?: SiteNoticeType,
  options?: { surface?: SiteNoticeSurface },
): Promise<PublicSiteNoticePayload[]> {
  return listPublicSiteNoticesCached(type ?? null, options?.surface ?? null);
}

export async function getActiveSiteNotice(type: SiteNoticeType): Promise<SiteNoticePayload | null> {
  const [notice] = await listSiteNotices(type, false);
  return notice ?? null;
}

function resolveStoredDisplayTarget(
  type: SiteNoticeType,
  displayTarget: SiteNoticeDisplayTarget | null | undefined,
): SiteNoticeDisplayTarget {
  return toDisplayTarget(type, displayTarget ?? SITE_NOTICE_DISPLAY_TARGET.BOTH);
}

export interface SiteNoticeWritePayload {
  type: SiteNoticeType;
  title: string;
  message: string;
  displayTarget?: SiteNoticeDisplayTarget | null;
  isActive: boolean;
  priority: number;
  visibleFrom?: string | null;
  visibleTo?: string | null;
}

export async function createSiteNotice(authorUserId: string, payload: SiteNoticeWritePayload) {
  const normalizedMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  const data: Prisma.SiteNoticeCreateInput = {
    type: payload.type,
    displayTarget: resolveStoredDisplayTarget(payload.type, payload.displayTarget),
    title: payload.title.trim(),
    message: normalizedMessage,
    isActive: payload.isActive,
    priority: payload.priority,
    visibleFrom: payload.visibleFrom ? new Date(payload.visibleFrom) : null,
    visibleTo: payload.visibleTo ? new Date(payload.visibleTo) : null,
    createdByUser: authorUserId ? { connect: { id: authorUserId } } : undefined,
  };

  const created = await prisma.siteNotice.create({ data });

  return created as SiteNoticeModel;
}

export async function updateSiteNotice(noticeId: string, payload: Partial<SiteNoticeWritePayload>) {
  const current = await prisma.siteNotice.findUnique({
    where: { id: noticeId },
    select: {
      type: true,
      displayTarget: true,
    },
  });

  if (!current) {
    const error = new Error("SITE_NOTICE_NOT_FOUND");
    error.name = "NotFoundError";
    throw error;
  }

  const nextType = payload.type ?? current.type;
  const nextDisplayTarget = payload.displayTarget ?? current.displayTarget;

  const data: Prisma.SiteNoticeUpdateInput = {
    displayTarget: resolveStoredDisplayTarget(nextType, nextDisplayTarget),
  };

  if (payload.type !== undefined) data.type = payload.type;
  if (payload.title !== undefined) data.title = payload.title.trim();
  if (payload.message !== undefined) data.message = payload.message.trim();
  if (payload.isActive !== undefined) data.isActive = payload.isActive;
  if (payload.priority !== undefined) data.priority = payload.priority;

  if (payload.visibleFrom !== undefined) {
    data.visibleFrom = payload.visibleFrom ? new Date(payload.visibleFrom) : null;
  }
  if (payload.visibleTo !== undefined) {
    data.visibleTo = payload.visibleTo ? new Date(payload.visibleTo) : null;
  }
  data.updatedAt = new Date();

  const updated = await prisma.siteNotice.update({
    where: { id: noticeId },
    data,
  });

  return updated as SiteNoticeModel;
}
