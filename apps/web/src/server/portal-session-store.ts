import type { PortalProvider } from "@cu12/core";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import type { CookieStateEntry, SecondaryAuthMethod } from "@/server/cyber-campus-session";

export type PortalApprovalRequestedAction = "BOOTSTRAP" | "START" | "CONFIRM";

type PortalSessionReadStore = {
  findUnique: typeof prisma.portalSession.findUnique;
};

type PortalApprovalReadStore = {
  findFirst: typeof prisma.portalApprovalSession.findFirst;
};

function getPortalSessionStore(): PortalSessionReadStore | null {
  const candidate = (prisma as unknown as Record<string, unknown>).portalSession;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const delegate = candidate as Partial<PortalSessionReadStore>;
  return typeof delegate.findUnique === "function"
    ? { findUnique: delegate.findUnique.bind(candidate) as typeof prisma.portalSession.findUnique }
    : null;
}

function getPortalApprovalStore(): PortalApprovalReadStore | null {
  const candidate = (prisma as unknown as Record<string, unknown>).portalApprovalSession;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const delegate = candidate as Partial<PortalApprovalReadStore>;
  return typeof delegate.findFirst === "function"
    ? { findFirst: delegate.findFirst.bind(candidate) as typeof prisma.portalApprovalSession.findFirst }
    : null;
}

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

function encodePendingCode(value: string | null): string | null {
  if (!value) return null;
  return encryptSecret(value);
}

function decodePendingCode(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

export async function getPortalSession(userId: string, provider: PortalProvider) {
  const store = getPortalSessionStore();
  if (!store) return null;

  const row = await store.findUnique({
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
  const store = getPortalApprovalStore();
  if (!store) return null;

  const row = await store.findFirst({
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
    requestedAction: row.requestedAction as PortalApprovalRequestedAction | null,
    pendingCode: decodePendingCode(row.encryptedPendingCode),
  };
}

export async function getPortalApprovalSession(id: string, userId: string) {
  const store = getPortalApprovalStore();
  if (!store) return null;

  const row = await store.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  return {
    ...row,
    cookieState: decodeCookieState(row.encryptedCookieState),
    methods: Array.isArray(row.methods) ? row.methods as unknown as SecondaryAuthMethod[] : [],
    requestedAction: row.requestedAction as PortalApprovalRequestedAction | null,
    pendingCode: decodePendingCode(row.encryptedPendingCode),
  };
}

export async function createPortalApprovalSession(input: {
  userId: string;
  provider: PortalProvider;
  jobId: string;
  cookieState: CookieStateEntry[];
  methods?: SecondaryAuthMethod[];
  expiresAt: Date;
  requestedAction?: PortalApprovalRequestedAction | null;
}) {
  return prisma.portalApprovalSession.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      jobId: input.jobId,
      encryptedCookieState: encodeCookieState(input.cookieState),
      methods: (input.methods ?? []) as unknown as object,
      expiresAt: input.expiresAt,
      status: "PENDING",
      requestedAction: input.requestedAction ?? null,
    },
  });
}

export async function updatePortalApprovalSessionState(input: {
  id: string;
  userId: string;
  cookieState?: CookieStateEntry[];
  status?: "PENDING" | "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELED";
  methods?: SecondaryAuthMethod[];
  requestedAction?: PortalApprovalRequestedAction | null;
  pendingCode?: string | null;
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
      ...(input.methods !== undefined ? { methods: input.methods as unknown as object } : {}),
      ...(input.requestedAction !== undefined ? { requestedAction: input.requestedAction } : {}),
      ...(input.pendingCode !== undefined ? { encryptedPendingCode: encodePendingCode(input.pendingCode) } : {}),
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
