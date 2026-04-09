import type { PortalCampus, PortalProvider } from "@cu12/core";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isMissingProviderColumnError, warnMissingProviderColumn, withDefaultProvider } from "@/lib/provider-compat";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { invalidateCachedAuthState, primeCachedCurrentProvider } from "@/server/auth-state-cache";

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

type Cu12AccountMutationRecord = {
  provider: PortalProvider;
  cu12Id: string;
  campus: PortalCampus | null;
};

type Cu12AccountProviderRecord = {
  userId: string;
  provider: PortalProvider;
};

const accountMutationSelect = {
  provider: true,
  cu12Id: true,
  campus: true,
} as const satisfies Prisma.Cu12AccountSelect;

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

function isMissingCu12AccountStateColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
    const column = String(error.meta?.column ?? "");
    return column.includes("accountStatus")
      || column.includes("statusReason")
      || error.message.includes("accountStatus")
      || error.message.includes("statusReason");
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return error.message.includes("accountStatus") || error.message.includes("statusReason");
  }

  if (error instanceof Error) {
    return (error.message.includes("accountStatus") || error.message.includes("statusReason"))
      && /(column|does not exist|Unknown column)/i.test(error.message);
  }

  return false;
}

let warnedMissingCu12AccountState = false;

function warnMissingCu12AccountStateColumns() {
  if (warnedMissingCu12AccountState) return;
  warnedMissingCu12AccountState = true;
  console.warn(
    "[portal] DB account state columns are missing. Falling back to legacy connected-account defaults. Run prisma db push.",
  );
}

function withQuizDefault<T extends { quizAutoSolveEnabled?: boolean }>(record: Omit<T, "quizAutoSolveEnabled">): T {
  return {
    ...record,
    quizAutoSolveEnabled: true,
  } as T;
}

function withAccountStateDefaults<T extends { accountStatus?: "CONNECTED" | "NEEDS_REAUTH" | "ERROR"; statusReason?: string | null }>(
  record: Omit<T, "accountStatus" | "statusReason">,
): T {
  return {
    ...record,
    accountStatus: "CONNECTED",
    statusReason: null,
  } as T;
}

type Cu12AutomationSettingsFallbackRecord =
  Omit<Cu12AutomationSettingsRecord, "provider" | "quizAutoSolveEnabled" | "accountStatus" | "statusReason">
  & Partial<Pick<Cu12AutomationSettingsRecord, "provider" | "quizAutoSolveEnabled" | "accountStatus" | "statusReason">>;

function toAutomationSettingsRecord(
  fallback: Cu12AutomationSettingsFallbackRecord,
  options: {
    missingProvider: boolean;
    missingQuiz: boolean;
    missingState: boolean;
  },
): Cu12AutomationSettingsRecord {
  const withProvider = options.missingProvider
    ? {
      ...fallback,
      provider: "CU12" as const,
    }
    : fallback;

  const withQuiz = options.missingQuiz
    ? withQuizDefault<Cu12AutomationSettingsFallbackRecord>(
      withProvider as Omit<Cu12AutomationSettingsFallbackRecord, "quizAutoSolveEnabled">,
    )
    : withProvider;

  return options.missingState
    ? withAccountStateDefaults<Cu12AutomationSettingsRecord>(
      withQuiz as Omit<Cu12AutomationSettingsRecord, "accountStatus" | "statusReason">,
    )
    : withQuiz as Cu12AutomationSettingsRecord;
}

type Cu12DashboardAccountFallbackRecord =
  Omit<Cu12DashboardAccountRecord, "provider" | "quizAutoSolveEnabled" | "accountStatus" | "statusReason">
  & Partial<Pick<Cu12DashboardAccountRecord, "provider" | "quizAutoSolveEnabled" | "accountStatus" | "statusReason">>;

function toDashboardAccountRecord(
  fallback: Cu12DashboardAccountFallbackRecord,
  options: {
    missingProvider: boolean;
    missingQuiz: boolean;
    missingState: boolean;
  },
): Cu12DashboardAccountRecord {
  const withProvider = options.missingProvider
    ? {
      ...fallback,
      provider: "CU12" as const,
    }
    : fallback;

  const withQuiz = options.missingQuiz
    ? withQuizDefault<Cu12DashboardAccountFallbackRecord>(
      withProvider as Omit<Cu12DashboardAccountFallbackRecord, "quizAutoSolveEnabled">,
    )
    : withProvider;

  return options.missingState
    ? withAccountStateDefaults<Cu12DashboardAccountRecord>(
      withQuiz as Omit<Cu12DashboardAccountRecord, "accountStatus" | "statusReason">,
    )
    : withQuiz as Cu12DashboardAccountRecord;
}

export async function getAccountProviderByCu12Id(cu12Id: string): Promise<Cu12AccountProviderRecord | null> {
  try {
    const account = await prisma.cu12Account.findFirst({
      where: { cu12Id },
      select: {
        userId: true,
        provider: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return account
      ? {
        userId: account.userId,
        provider: account.provider as PortalProvider,
      }
      : null;
  } catch (error) {
    if (!isMissingProviderColumnError(error)) {
      throw error;
    }

    warnMissingProviderColumn();
    const legacy = await prisma.cu12Account.findFirst({
      where: { cu12Id },
      select: {
        userId: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return legacy
      ? {
        userId: legacy.userId,
        provider: "CU12",
      }
      : null;
  }
}

export async function upsertCu12Account(userId: string, input: Cu12AccountInput) {
  let existing: {
    provider?: PortalProvider;
    campus: PortalCampus | null;
  } | null;

  try {
    const found = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        provider: true,
        campus: true,
      },
    });
    existing = found
      ? {
        provider: found.provider as PortalProvider | undefined,
        campus: (found.campus as PortalCampus | null | undefined) ?? null,
      }
      : null;
  } catch (error) {
    if (!isMissingProviderColumnError(error)) {
      throw error;
    }

    warnMissingProviderColumn();
    const legacy = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        campus: true,
      },
    });
    existing = legacy
      ? {
        provider: "CU12",
        campus: (legacy.campus as PortalCampus | null | undefined) ?? null,
      }
      : null;
  }

  const currentProvider = input.currentProvider ?? input.provider ?? (existing?.provider as PortalProvider | undefined) ?? "CU12";
  const campus = input.campus !== undefined
    ? input.campus
    : (existing?.campus as PortalCampus | null | undefined) ?? null;

  if (existing) {
    try {
      const updated = await prisma.cu12Account.update({
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
        select: accountMutationSelect,
      });
      primeCachedCurrentProvider(userId, updated.provider as PortalProvider);
      return updated;
    } catch (error) {
      const missingProvider = isMissingProviderColumnError(error);
      const missingState = isMissingCu12AccountStateColumnError(error);
      if (!missingProvider && !missingState) {
        throw error;
      }

      if (missingProvider) {
        warnMissingProviderColumn();
      }
      const legacy = await prisma.cu12Account.update({
        where: { userId },
        data: {
          cu12Id: input.cu12Id,
          encryptedPassword: encryptSecret(input.cu12Password),
          campus,
          ...(missingState ? {} : {
            accountStatus: "CONNECTED",
            statusReason: null,
            updatedAt: new Date(),
          }),
        },
        select: {
          cu12Id: true,
          campus: true,
        },
      });
      const next = withDefaultProvider<Cu12AccountMutationRecord>({
        cu12Id: legacy.cu12Id,
        campus: (legacy.campus as PortalCampus | null | undefined) ?? null,
      });
      primeCachedCurrentProvider(userId, next.provider);
      return next;
    }
  }

  try {
    const created = await prisma.cu12Account.create({
      data: {
        userId,
        provider: currentProvider,
        cu12Id: input.cu12Id,
        encryptedPassword: encryptSecret(input.cu12Password),
        campus,
        accountStatus: "CONNECTED",
      },
      select: accountMutationSelect,
    });
    primeCachedCurrentProvider(userId, created.provider as PortalProvider);
    return created;
  } catch (error) {
    const missingProvider = isMissingProviderColumnError(error);
    const missingState = isMissingCu12AccountStateColumnError(error);
    if (!missingProvider && !missingState) {
      throw error;
    }

    if (missingProvider) {
      warnMissingProviderColumn();
    }
    const legacy = await prisma.cu12Account.create({
      data: {
        userId,
        cu12Id: input.cu12Id,
        encryptedPassword: encryptSecret(input.cu12Password),
        campus,
        ...(missingState ? {} : { accountStatus: "CONNECTED" }),
      },
      select: {
        cu12Id: true,
        campus: true,
      },
    });
    const next = withDefaultProvider<Cu12AccountMutationRecord>({
      cu12Id: legacy.cu12Id,
      campus: (legacy.campus as PortalCampus | null | undefined) ?? null,
    });
    primeCachedCurrentProvider(userId, next.provider);
    return next;
  }
}

export async function getCu12Credentials(userId: string) {
  let account:
    | {
      provider?: PortalProvider;
      cu12Id: string;
      encryptedPassword: string;
      campus: string | null;
      quizAutoSolveEnabled?: boolean;
    }
    | null;

  try {
    account = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        provider: true,
        cu12Id: true,
        encryptedPassword: true,
        campus: true,
        quizAutoSolveEnabled: true,
      },
    });
  } catch (error) {
    const missingProvider = isMissingProviderColumnError(error);
    const missingQuiz = isMissingQuizAutoSolveEnabledColumnError(error);
    if (!missingProvider && !missingQuiz) {
      throw error;
    }

    if (missingProvider) {
      warnMissingProviderColumn();
    }

    account = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        ...(missingProvider ? {} : { provider: true }),
        cu12Id: true,
        encryptedPassword: true,
        campus: true,
        ...(missingQuiz ? {} : { quizAutoSolveEnabled: true }),
      },
    });
  }
  if (!account) return null;

  return {
    provider: (account.provider as PortalProvider | undefined) ?? "CU12",
    cu12Id: account.cu12Id,
    cu12Password: decryptSecret(account.encryptedPassword),
    campus: (account.campus ?? null) as PortalCampus | null,
    quizAutoSolveEnabled: account.quizAutoSolveEnabled ?? true,
  };
}

export async function getAutomationSettingsAccount(userId: string): Promise<Cu12AutomationSettingsRecord | null> {
  try {
    return await prisma.cu12Account.findUnique({
      where: { userId },
      select: automationSettingsSelect,
    });
  } catch (error) {
    const missingProvider = isMissingProviderColumnError(error);
    const missingQuiz = isMissingQuizAutoSolveEnabledColumnError(error);
    const missingState = isMissingCu12AccountStateColumnError(error);
    if (!missingProvider && !missingQuiz && !missingState) {
      throw error;
    }

    if (missingProvider) {
      warnMissingProviderColumn();
    }
    if (missingState) {
      warnMissingCu12AccountStateColumns();
    }

    const fallback = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        ...(missingProvider ? {} : { provider: true }),
        cu12Id: true,
        campus: true,
        ...(missingState ? {} : { accountStatus: true, statusReason: true }),
        autoLearnEnabled: true,
        ...(missingQuiz ? {} : { quizAutoSolveEnabled: true }),
        detectActivitiesEnabled: true,
        emailDigestEnabled: true,
        updatedAt: true,
      },
    });
    if (!fallback) return null;

    return toAutomationSettingsRecord(fallback, { missingProvider, missingQuiz, missingState });
  }
}

export async function getDashboardAccount(userId: string): Promise<Cu12DashboardAccountRecord | null> {
  try {
    return await prisma.cu12Account.findUnique({
      where: { userId },
      select: dashboardAccountSelect,
    });
  } catch (error) {
    const missingProvider = isMissingProviderColumnError(error);
    const missingQuiz = isMissingQuizAutoSolveEnabledColumnError(error);
    const missingState = isMissingCu12AccountStateColumnError(error);
    if (!missingProvider && !missingQuiz && !missingState) {
      throw error;
    }

    if (missingProvider) {
      warnMissingProviderColumn();
    }
    if (missingState) {
      warnMissingCu12AccountStateColumns();
    }

    const fallback = await prisma.cu12Account.findUnique({
      where: { userId },
      select: {
        ...(missingProvider ? {} : { provider: true }),
        cu12Id: true,
        campus: true,
        ...(missingState ? {} : { accountStatus: true, statusReason: true }),
        autoLearnEnabled: true,
        ...(missingQuiz ? {} : { quizAutoSolveEnabled: true }),
        user: {
          select: {
            lastLoginAt: true,
            lastLoginIp: true,
          },
        },
      },
    });
    if (!fallback) return null;

    return toDashboardAccountRecord(fallback, { missingProvider, missingQuiz, missingState });
  }
}

export async function updateAutomationSettings(userId: string, input: AutomationSettingsInput) {
  let currentProvider: PortalProvider = "CU12";

  try {
    const current = await prisma.cu12Account.findUnique({ where: { userId }, select: { provider: true } });
    if (!current) {
      throw new Error("Account not found");
    }
    currentProvider = current.provider as PortalProvider;
  } catch (error) {
    if (error instanceof Error && error.message === "Account not found") {
      throw error;
    }
    if (!isMissingProviderColumnError(error)) {
      throw error;
    }

    warnMissingProviderColumn();
    const current = await prisma.cu12Account.findUnique({ where: { userId }, select: { userId: true } });
    if (!current) {
      throw new Error("Account not found");
    }
  }

  const data = {
    provider: input.currentProvider,
    autoLearnEnabled: input.autoLearnEnabled,
    quizAutoSolveEnabled: input.quizAutoSolveEnabled,
    detectActivitiesEnabled: input.detectActivitiesEnabled,
    emailDigestEnabled: input.emailDigestEnabled,
  };

  try {
    const updated = await prisma.cu12Account.update({
      where: { userId },
      data,
      select: automationSettingsSelect,
    });
    primeCachedCurrentProvider(userId, updated.provider as PortalProvider);
    return updated;
  } catch (error) {
    const missingProvider = isMissingProviderColumnError(error);
    const missingQuiz = isMissingQuizAutoSolveEnabledColumnError(error);
    const missingState = isMissingCu12AccountStateColumnError(error);
    if (!missingProvider && !missingQuiz && !missingState) {
      throw error;
    }

    if (missingProvider) {
      warnMissingProviderColumn();
    }
    if (missingState) {
      warnMissingCu12AccountStateColumns();
    }

    const fallback = await prisma.cu12Account.update({
      where: { userId },
      data: {
        ...(missingProvider ? {} : { provider: input.currentProvider ?? currentProvider }),
        autoLearnEnabled: input.autoLearnEnabled,
        ...(missingQuiz ? {} : { quizAutoSolveEnabled: input.quizAutoSolveEnabled }),
        detectActivitiesEnabled: input.detectActivitiesEnabled,
        emailDigestEnabled: input.emailDigestEnabled,
      },
      select: {
        ...(missingProvider ? {} : { provider: true }),
        cu12Id: true,
        campus: true,
        ...(missingState ? {} : { accountStatus: true, statusReason: true }),
        autoLearnEnabled: true,
        ...(missingQuiz ? {} : { quizAutoSolveEnabled: true }),
        detectActivitiesEnabled: true,
        emailDigestEnabled: true,
        updatedAt: true,
      },
    });
    const next = toAutomationSettingsRecord(fallback, { missingProvider, missingQuiz, missingState });
    primeCachedCurrentProvider(userId, next.provider as PortalProvider);
    return next;
  }
}

export async function setCurrentPortalProvider(userId: string, provider: PortalProvider) {
  const updated = await prisma.cu12Account.update({
    where: { userId },
    data: {
      provider,
      updatedAt: new Date(),
    },
  });
  primeCachedCurrentProvider(userId, updated.provider as PortalProvider);
  return updated;
}

export async function markCu12Status(userId: string, accountStatus: "CONNECTED" | "NEEDS_REAUTH" | "ERROR", reason?: string) {
  try {
    const updated = await prisma.cu12Account.update({
      where: { userId },
      data: {
        accountStatus,
        statusReason: reason ?? null,
        updatedAt: new Date(),
      },
    });
    invalidateCachedAuthState(userId);
    return updated;
  } catch (error) {
    if (!isMissingCu12AccountStateColumnError(error)) {
      throw error;
    }

    warnMissingCu12AccountStateColumns();
    const updated = await prisma.cu12Account.update({
      where: { userId },
      data: {
        updatedAt: new Date(),
      },
    });
    invalidateCachedAuthState(userId);
    return updated;
  }
}
