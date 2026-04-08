import type { PortalProvider } from "@cu12/core";
import type { NextRequest } from "next/server";
import { getCurrentPortalProvider } from "@/server/current-provider";
import { normalizePortalProvider } from "@/server/portal-provider";

export async function resolveRequestPortalProvider(
  request: NextRequest,
  userId: string,
  paramName = "provider",
): Promise<PortalProvider> {
  const raw = new URL(request.url).searchParams.get(paramName);
  if (raw) {
    return normalizePortalProvider(raw);
  }
  return getCurrentPortalProvider(userId);
}
