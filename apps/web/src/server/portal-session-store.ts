import type { PortalProvider } from "@cu12/core";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { CookieStateEntry, SecondaryAuthMethod } from "@/server/cyber-campus-session";

function encodeCookieState(cookieState: CookieStateEntry[]): string {
  return encryptSecret(JSON.stringify(cookieState));
}

function decodeCookieState(payload: string): CookieStateEntry[] {
  try {
    const raw = JSON.parse(decryptSecret(payload)) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const name = (item as { name?: unknown }).name;
        const value = (item as { value?: unknown }).value;
        if (typeof name !== "string" || typeof value !== "string") return null;
        return { name, value };
      })
      .filter((item): item is CookieStateEntry => item !== null);
  } catch {
    return [];
  }
}

export async function getPortalSession(userId: string, provider: PortalProvider) {
  const row = await prisma.portalSession.findUnique({
    where: {
      userId_provider: {
        userId,
        provider,
      },
    },
  });
  if (!row) return null;
  return {
    ...row,
    cookieState: decodeCookieState(row.encryptedCookieState),
  };
}

export async function upsertPortalSession(input: {
  userId: string;
  provider: PortalProvider;
  cookieState: CookieStateEntry[];
  expiresAt?: Date | null;
  status?: "ACTIVE" | "EXPIRED" | "INVALID";
}) {
  return prisma.portalSession.upsert({
    where: {
      userId_provider: {
        userId: input.userId,
        provider: input.provider,
      },
    },
    update: {
      encryptedCookieState: encodeCookieState(input.cookieState),
      expiresAt: input.expiresAt ?? null,
      status: input.status ?? "ACTIVE",
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      userId: input.userId,
      provider: input.provider,
      encryptedCookieState: encodeCookieState(input.cookieState),
      expiresAt: input.expiresAt ?? null,
      status: input.status ?? "ACTIVE",
      lastVerifiedAt: new Date(),
    },
  });
}

export async function markPortalSessionInvalid(userId: string, provider: PortalProvider) {
  await prisma.portalSession.updateMany({
    where: { userId, provider },
    data: {
      status: "INVALID",
      updatedAt: new Date(),
    },
  });
}

export async function findActivePortalApprovalSession(userId: string, provider: PortalProvider) {
  const row = await prisma.portalApprovalSession.findFirst({
    where: {
      userId,
      provider,
      status: { in: ["PENDING", "ACTIVE"] },
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    ...row,
    cookieState: decodeCookieState(row.encryptedCookieState),
    methods: Array.isArray(row.methods) ? row.methods as unknown as SecondaryAuthMethod[] : [],
  };
}

export async function getPortalApprovalSession(id: string, userId: string) {
  const row = await prisma.portalApprovalSession.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  return {
    ...row,
    cookieState: decodeCookieState(row.encryptedCookieState),
    methods: Array.isArray(row.methods) ? row.methods as unknown as SecondaryAuthMethod[] : [],
  };
}

export async function createPortalApprovalSession(input: {
  userId: string;
  provider: PortalProvider;
  jobId: string;
  cookieState: CookieStateEntry[];
  methods: SecondaryAuthMethod[];
  expiresAt: Date;
}) {
  return prisma.portalApprovalSession.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      jobId: input.jobId,
      encryptedCookieState: encodeCookieState(input.cookieState),
      methods: input.methods as unknown as object,
      expiresAt: input.expiresAt,
      status: "PENDING",
    },
  });
}

export async function updatePortalApprovalSessionState(input: {
  id: string;
  userId: string;
  cookieState?: CookieStateEntry[];
  status?: "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";
  selectedWay?: number | null;
  selectedParam?: string | null;
  selectedTarget?: string | null;
  authSeq?: string | null;
  requestCode?: string | null;
  displayCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: Date;
  completedAt?: Date | null;
  canceledAt?: Date | null;
}) {
  return prisma.portalApprovalSession.updateMany({
    where: { id: input.id, userId: input.userId },
    data: {
      ...(input.cookieState ? { encryptedCookieState: encodeCookieState(input.cookieState) } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.selectedWay !== undefined ? { selectedWay: input.selectedWay } : {}),
      ...(input.selectedParam !== undefined ? { selectedParam: input.selectedParam } : {}),
      ...(input.selectedTarget !== undefined ? { selectedTarget: input.selectedTarget } : {}),
      ...(input.authSeq !== undefined ? { authSeq: input.authSeq } : {}),
      ...(input.requestCode !== undefined ? { requestCode: input.requestCode } : {}),
      ...(input.displayCode !== undefined ? { displayCode: input.displayCode } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.canceledAt !== undefined ? { canceledAt: input.canceledAt } : {}),
      updatedAt: new Date(),
    },
  });
}
