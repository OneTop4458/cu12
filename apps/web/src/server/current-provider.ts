import type { PortalProvider } from "@cu12/core";
import { prisma } from "@/lib/prisma";

export async function getCurrentPortalProvider(userId: string): Promise<PortalProvider> {
  const account = await prisma.cu12Account.findUnique({
    where: { userId },
    select: { provider: true },
  });
  return (account?.provider as PortalProvider | undefined) ?? "CU12";
}
