import type { PortalProvider } from "@cu12/core";
import { prisma } from "@/lib/prisma";
import { withWithdrawnAtFallback } from "@/lib/withdrawn-compat";

const AUTH_STATE_TTL_MS = 60_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type InflightEntry<T> = Promise<T>;

export interface CachedActiveUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  withdrawnAt: Date | null;
  createdAt: Date;
}

type CacheStore = {
  users: Map<string, CacheEntry<CachedActiveUser | null>>;
  providers: Map<string, CacheEntry<PortalProvider>>;
  userInflight: Map<string, InflightEntry<CachedActiveUser | null>>;
  providerInflight: Map<string, InflightEntry<PortalProvider>>;
};

declare global {
  // eslint-disable-next-line no-var
  var __cu12AuthStateCache: CacheStore | undefined;
}

function getStore(): CacheStore {
  if (!global.__cu12AuthStateCache) {
    global.__cu12AuthStateCache = {
      users: new Map(),
      providers: new Map(),
      userInflight: new Map(),
      providerInflight: new Map(),
    };
  }

  return global.__cu12AuthStateCache;
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;

  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return hit.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  cache.set(key, {
    expiresAt: Date.now() + AUTH_STATE_TTL_MS,
    value,
  });
}

async function loadActiveUser(userId: string): Promise<CachedActiveUser | null> {
  const user = await withWithdrawnAtFallback(
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          withdrawnAt: true,
          createdAt: true,
        },
      }),
    () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),
  );

  if (!user || !user.isActive || user.withdrawnAt !== null) {
    return null;
  }

  return user;
}

async function loadCurrentProvider(userId: string): Promise<PortalProvider> {
  const account = await prisma.cu12Account.findUnique({
    where: { userId },
    select: { provider: true },
  });

  return (account?.provider as PortalProvider | undefined) ?? "CU12";
}

export async function getCachedActiveUser(userId: string): Promise<CachedActiveUser | null> {
  const store = getStore();
  const cached = getCachedValue(store.users, userId);
  if (cached !== undefined) {
    return cached;
  }

  const inflight = store.userInflight.get(userId);
  if (inflight) {
    return inflight;
  }

  const next = loadActiveUser(userId)
    .then((value) => {
      setCachedValue(store.users, userId, value);
      return value;
    })
    .finally(() => {
      store.userInflight.delete(userId);
    });

  store.userInflight.set(userId, next);
  return next;
}

export async function getCachedCurrentProvider(userId: string): Promise<PortalProvider> {
  const store = getStore();
  const cached = getCachedValue(store.providers, userId);
  if (cached !== undefined) {
    return cached;
  }

  const inflight = store.providerInflight.get(userId);
  if (inflight) {
    return inflight;
  }

  const next = loadCurrentProvider(userId)
    .then((value) => {
      setCachedValue(store.providers, userId, value);
      return value;
    })
    .finally(() => {
      store.providerInflight.delete(userId);
    });

  store.providerInflight.set(userId, next);
  return next;
}

export function primeCachedCurrentProvider(userId: string, provider: PortalProvider) {
  const store = getStore();
  setCachedValue(store.providers, userId, provider);
}

export function invalidateCachedAuthState(userId: string) {
  const store = getStore();
  store.users.delete(userId);
  store.providers.delete(userId);
  store.userInflight.delete(userId);
  store.providerInflight.delete(userId);
}
