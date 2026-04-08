import type { PortalProvider } from "@cu12/core";

export const DEFAULT_PORTAL_PROVIDER: PortalProvider = "CU12";
export const PORTAL_PROVIDER_VALUES = ["CU12", "CYBER_CAMPUS"] as const;

export function normalizePortalProvider(value?: string | null): PortalProvider {
  return value === "CYBER_CAMPUS" ? "CYBER_CAMPUS" : DEFAULT_PORTAL_PROVIDER;
}

export function providerSupportsCampus(provider: PortalProvider): boolean {
  return provider === "CU12";
}

export function portalDisplayName(provider: PortalProvider): string {
  return provider === "CYBER_CAMPUS" ? "Cyber Campus" : "CU12";
}
