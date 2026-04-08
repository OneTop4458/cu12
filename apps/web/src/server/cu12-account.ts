import type { PortalCampus, PortalProvider } from "@cu12/core";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface Cu12AccountInput {
  provider?: PortalProvider;
  currentProvider?: PortalProvider;
  cu12Id: string;
  cu12Password: string;
  campus?: PortalCampus | null;
}

export interface AutomationSettingsInput {
  currentProvider?: PortalProvider;
  autoLearnEnabled?: boolean;
  quizAutoSolveEnabled?: boolean;
  detectActivitiesEnabled?: boolean;
  emailDigestEnabled?: boolean;
}

const automationSettingsSelect = {
  provider: true,
  cu12Id: true,
  campus: true,
  accountStatus: true,
  statusReason: true,
  autoLearnEnabled: true,
  quizAutoSolveEnabled: true,
  detectActivitiesEnabled: true,
  emailDigestEnabled: true,
  updatedAt: true,
} as const satisfies Prisma.Cu12AccountSelect;

type Cu12AutomationSettingsRecord = Prisma.Cu12AccountGetPayload<{
  select: typeof automationSettingsSelect;
}>;

const dashboardAccountSelect = {
  provider: true,
  cu12Id: true,
  campus: true,
  accountStatus: true,
  statusReason: true,
  autoLearnEnabled: true,
  quizAutoSolveEnabled: true,
  user: {
    select: {
      lastLoginAt: true,
      lastLoginIp: true,
    },
  },
} as const satisfies Prisma.Cu12AccountSelect;

type Cu12DashboardAccountRecord = Prisma.Cu12AccountGetPayload<{
  select: typeof dashboardAccountSelect;
}>;

function isMissingQuizAutoSolveEnabledColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const column = String(error.meta?.column ?? "");
    return column.includes("quizAutoSolveEnabled") || error.message.includes("quizAutoSolveEnabled");
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes("quizAutoSolveEnabled");
  }

  if (error instanceof Error) {
    return error.message.includes("quizAutoSolveEnabled")
      && /(column|does not exist|Unknown column)/i.test(error.message);
  }

  return false;
}

function withQuizDefault<T extends { quizAutoSolveEnabled?: boolean }>(record: Omit<T, "quizAutoSolveEnabled">): T {
  return {
    ...record,
    quizAutoSolveEnabled: true,
  } as T;
}

export async function upsertCu12Account(userId: string, input: Cu12AccountInput) {
  const existing = await prisma.cu12Account.findUnique({
    where: { userId },
    select: {
      provider: true,
      campus: true,
    },
  });

  const currentProvider = input.currentProvider ?? input.provider ?? (existing?.provider as PortalProvider | undefined) ?? "CU12";
  const campus = input.campus ?? (existing?.campus as PortalCampus | null | undefined) ?? "SONGSIM";

  if (existing) {
    return prisma.cu12Account.update({
      where: { userId },
      data: {
        provider: currentProvider,
        cu12Id: input.cu12Id,
        encryptedPassword: encryptSecret(input.cu12Password),
        campus,
        accountStatus: "CONNECTED",
        statusReason: null,
        updatedAt: new Date(),
      },
    });
  }

  return prisma.cu12Account.create({
    data: {
      userId,
      provider: currentProvider,
      cu12Id: input.cu12Id,
      encryptedPassword: encryptSecret(input.cu12Password),
      campus,
      accountStatus: "CONNECTED",
    },
  });
}

export async function getCu12Credentials(userId: string) {
  const account = await prisma.cu12Account.findUnique({ where: { userId } });
  if (!account) return null;

  return {
    provider: account.provider as PortalProvider,
    cu12Id: account.cu12Id,
    cu12Password: decryptSecret(account.encryptedPassword),
    campus: (account.campus ?? null) as PortalCampus | null,
  };
}

export async function getAutomationSettingsAccount(userId: string): Promise<Cu12AutomationSettingsRecord | null> {
  try {
    return await prisma.cu12Account.findUnique({
      where: { userId },
      select: automationSettingsSelect,
    });
  } catch (error) {
    if (!isMissingQuizAutoSolveEnabledColumnError(error)) {
      throw error;
    }

    const fallback = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        provider: true,
        cu12Id: true,
        campus: true,
        accountStatus: true,
        statusReason: true,
        autoLearnEnabled: true,
        detectActivitiesEnabled: true,
        emailDigestEnabled: true,
        updatedAt: true,
      },
    });
    return fallback ? withQuizDefault<Cu12AutomationSettingsRecord>(fallback) : null;
  }
}

export async function getDashboardAccount(userId: string): Promise<Cu12DashboardAccountRecord | null> {
  try {
    return await prisma.cu12Account.findUnique({
      where: { userId },
      select: dashboardAccountSelect,
    });
  } catch (error) {
    if (!isMissingQuizAutoSolveEnabledColumnError(error)) {
      throw error;
    }

    const fallback = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        provider: true,
        cu12Id: true,
        campus: true,
        accountStatus: true,
        statusReason: true,
        autoLearnEnabled: true,
        user: {
          select: {
            lastLoginAt: true,
            lastLoginIp: true,
          },
        },
      },
    });
    return fallback ? withQuizDefault<Cu12DashboardAccountRecord>(fallback) : null;
  }
}

export async function updateAutomationSettings(userId: string, input: AutomationSettingsInput) {
  const current = await prisma.cu12Account.findUnique({ where: { userId }, select: { provider: true } });
  if (!current) {
    throw new Error("Account not found");
  }

  const data = {
    provider: input.currentProvider,
    autoLearnEnabled: input.autoLearnEnabled,
    quizAutoSolveEnabled: input.quizAutoSolveEnabled,
    detectActivitiesEnabled: input.detectActivitiesEnabled,
    emailDigestEnabled: input.emailDigestEnabled,
  };

  try {
    return await prisma.cu12Account.update({
      where: { userId },
      data,
      select: automationSettingsSelect,
    });
  } catch (error) {
    if (!isMissingQuizAutoSolveEnabledColumnError(error)) {
      throw error;
    }

    const fallback = await prisma.cu12Account.update({
      where: { userId },
      data: {
        provider: input.currentProvider ?? current.provider,
        autoLearnEnabled: input.autoLearnEnabled,
        detectActivitiesEnabled: input.detectActivitiesEnabled,
        emailDigestEnabled: input.emailDigestEnabled,
      },
      select: {
        provider: true,
        cu12Id: true,
        campus: true,
        accountStatus: true,
        statusReason: true,
        autoLearnEnabled: true,
        detectActivitiesEnabled: true,
        emailDigestEnabled: true,
        updatedAt: true,
      },
    });
    return withQuizDefault<Cu12AutomationSettingsRecord>(fallback);
  }
}

export async function setCurrentPortalProvider(userId: string, provider: PortalProvider) {
  return prisma.cu12Account.update({
    where: { userId },
    data: {
      provider,
      updatedAt: new Date(),
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
