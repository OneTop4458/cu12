import type { PortalProvider } from "@cu12/core";
import { prisma } from "./prisma";
import { persistSnapshot } from "./sync-store";

export type SyncSnapshot = Parameters<typeof persistSnapshot>[2];
export type SyncPersistence = Awaited<ReturnType<typeof persistSnapshot>>;

// Both collectors return the complete provider snapshot, including an authoritative empty roster.
// The checkpoint is written only after persistence and notification processing have succeeded.
export async function completeSyncSnapshot(
  userId: string,
  provider: PortalProvider,
  snapshot: SyncSnapshot,
  source: "SYNC" | "NOTICE_SCAN" | "AUTOLEARN",
  notify: (snapshot: SyncSnapshot, persisted: SyncPersistence) => Promise<void>,
) {
  const collectedAt = new Date();
  const persisted = await persistSnapshot(userId, provider, snapshot);
  await notify(snapshot, persisted);
  if (snapshot.courseRosterAuthoritative) {
    await prisma.providerSyncState.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, lastFullSyncAt: collectedAt, source },
      update: { lastFullSyncAt: collectedAt, source },
    });
  }
  return persisted;
}
