import type { PortalCampus, PortalProvider } from "./types";

export const PORTAL_PROVIDERS = ["CU12", "CYBER_CAMPUS"] as const satisfies readonly PortalProvider[];

export function hasCu12Campus(value: string | PortalCampus | null | undefined): value is PortalCampus {
  return value === "SONGSIM" || value === "SONGSIN";
}

export function normalizePortalProviders(values: Iterable<string | PortalProvider>): PortalProvider[] {
  const normalized = new Set<PortalProvider>();

  for (const value of values) {
    if (value === "CYBER_CAMPUS") {
      normalized.add("CYBER_CAMPUS");
      continue;
    }
    if (value === "CU12") {
      normalized.add("CU12");
    }
  }

  return PORTAL_PROVIDERS.filter((provider) => normalized.has(provider));
}

export function resolveSyncProviders(
  campus: string | PortalCampus | null | undefined,
  requestedProviders?: Iterable<string | PortalProvider>,
): PortalProvider[] {
  const availableProviders: PortalProvider[] = hasCu12Campus(campus)
    ? ["CU12", "CYBER_CAMPUS"]
    : ["CYBER_CAMPUS"];

  if (!requestedProviders) {
    return availableProviders;
  }

  const requested = new Set(normalizePortalProviders(requestedProviders));
  return availableProviders.filter((provider) => requested.has(provider));
}
