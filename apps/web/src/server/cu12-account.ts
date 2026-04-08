import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export interface Cu12AccountInput {
  cu12Id: string;
  cu12Password: string;
  campus: "SONGSIM" | "SONGSIN";
}

export interface AutomationSettingsInput {
  autoLearnEnabled?: boolean;
  quizAutoSolveEnabled?: boolean;
  detectActivitiesEnabled?: boolean;
  emailDigestEnabled?: boolean;
}

export async function upsertCu12Account(userId: string, input: Cu12AccountInput) {
  return prisma.cu12Account.upsert({
    where: { userId },
    update: {
      cu12Id: input.cu12Id,
      encryptedPassword: encryptSecret(input.cu12Password),
      campus: input.campus,
      accountStatus: "CONNECTED",
      statusReason: null,
      updatedAt: new Date(),
    },
    create: {
      userId,
      cu12Id: input.cu12Id,
      encryptedPassword: encryptSecret(input.cu12Password),
      campus: input.campus,
      accountStatus: "CONNECTED",
    },
  });
}

export async function getCu12Credentials(userId: string) {
  const account = await prisma.cu12Account.findUnique({ where: { userId } });
  if (!account) return null;

  return {
    cu12Id: account.cu12Id,
    cu12Password: decryptSecret(account.encryptedPassword),
    campus: account.campus,
  };
}

export async function updateAutomationSettings(userId: string, input: AutomationSettingsInput) {
  return prisma.cu12Account.update({
    where: { userId },
    data: {
      autoLearnEnabled: input.autoLearnEnabled,
      quizAutoSolveEnabled: input.quizAutoSolveEnabled,
      detectActivitiesEnabled: input.detectActivitiesEnabled,
      emailDigestEnabled: input.emailDigestEnabled,
    },
  });
}

export async function markCu12Status(userId: string, accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR", reason?: string) {
  return prisma.cu12Account.update({
    where: { userId },
    data: {
      accountStatus,
      statusReason: reason ?? null,
      updatedAt: new Date(),
    },
  });
}
