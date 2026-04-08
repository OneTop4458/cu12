import type { PortalProvider } from "@cu12/core";
import { isMissingProviderColumnError, warnMissingProviderColumn } from "@/lib/provider-compat";
import { prisma } from "@/lib/prisma";

export async function getCurrentPortalProvider(userId: string): Promise<PortalProvider> {
  try {
    const account = await prisma.cu12Account.findUnique({
      where: { userId },
      select: { provider: true },
    });
    return (account?.provider as PortalProvider | undefined) ?? "CU12";
  } catch (error) {
    if (!isMissingProviderColumnError(error)) {
      throw error;
    }

    warnMissingProviderColumn();
    return "CU12";
  }
}
