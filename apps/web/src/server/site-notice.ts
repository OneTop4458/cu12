import { Prisma } from "@prisma/client";
import { SiteNoticeType } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

export type SiteNoticePayload = {
  id: string;
  title: string;
  message: string;
  type: SiteNoticeType;
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

type VisibilityDateFilter = {
  isActive?: boolean;
  includeInactive?: boolean;
  now?: Date;
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

export const PUBLIC_SITE_NOTICES_TAG = "public-site-notices";

export type PublicSiteNoticePayload = Omit<SiteNoticePayload, "createdByUser">;

function toNullableIso(value: Date | null): string | null {
  if (!value) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function buildBaseWhere(type?: SiteNoticeType, options?: VisibilityDateFilter): Prisma.SiteNoticeWhereInput {
  const includeInactive = options?.includeInactive ?? false;
  const now = options?.now ?? new Date();

  if (includeInactive) {
    return type ? { type } : {};
  }

  return {
    type: type ?? undefined,
    isActive: true,
    AND: [
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
    ],
  };
}

export async function listSiteNotices(type?: SiteNoticeType, includeInactive = false) {
  const now = new Date();
  const records = await prisma.siteNotice.findMany({
    where: buildBaseWhere(type, { includeInactive, now }),
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

  return records.map((record) => ({
    id: record.id,
    title: record.title,
    message: record.message,
    type: record.type,
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
  }) as SiteNoticePayload);
}

const listPublicSiteNoticesCached = unstable_cache(
  async (type: SiteNoticeType | null) => {
    if (!process.env.DATABASE_URL) {
      return [] satisfies PublicSiteNoticePayload[];
    }

    const now = new Date();
    const records = await prisma.siteNotice.findMany({
      where: buildBaseWhere(type ?? undefined, { includeInactive: false, now }),
      orderBy: [
        { priority: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isActive: true,
        priority: true,
        visibleFrom: true,
        visibleTo: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return records.map((record) => ({
      id: record.id,
      title: record.title,
      message: record.message,
      type: record.type,
      isActive: record.isActive,
      priority: record.priority,
      visibleFrom: toNullableIso(record.visibleFrom),
      visibleTo: toNullableIso(record.visibleTo),
      createdAt: toNullableIso(record.createdAt) ?? "",
      updatedAt: toNullableIso(record.updatedAt) ?? "",
    }) satisfies PublicSiteNoticePayload);
  },
  ["public-site-notices"],
  {
    revalidate: 60,
    tags: [PUBLIC_SITE_NOTICES_TAG],
  },
);

export async function listPublicSiteNotices(type?: SiteNoticeType): Promise<PublicSiteNoticePayload[]> {
  return listPublicSiteNoticesCached(type ?? null);
}

export async function getActiveSiteNotice(type: SiteNoticeType, now = new Date()): Promise<SiteNoticePayload | null> {
  const [notice] = await listSiteNotices(type, false);
  return notice ?? null;
}

export interface SiteNoticeWritePayload {
  type: SiteNoticeType;
  title: string;
  message: string;
  isActive: boolean;
  priority: number;
  visibleFrom?: string | null;
  visibleTo?: string | null;
}

export async function createSiteNotice(authorUserId: string, payload: SiteNoticeWritePayload) {
  const normalizedMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  const data: Prisma.SiteNoticeCreateInput = {
    type: payload.type,
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
  const data: Prisma.SiteNoticeUpdateInput = {};
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
