import type { PortalProvider } from "@cu12/core";
import { getCachedCurrentProvider } from "@/server/auth-state-cache";

export async function getCurrentPortalProvider(userId: string): Promise<PortalProvider> {
  return getCachedCurrentProvider(userId);
}
