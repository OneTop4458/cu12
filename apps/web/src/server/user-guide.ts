import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DASHBOARD_MANUAL_GUIDE_KEY = "dashboard-manual";
export const DASHBOARD_MANUAL_VERSION = "dashboard-manual-v1";

export type DashboardManualGuideState = {
  version: typeof DASHBOARD_MANUAL_VERSION;
  dismissedAt: string | null;
  shouldAutoOpen: boolean;
};

let warnedMissingUserGuideStateStore = false;

function isMissingUserGuideStateStoreError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(" ") : String(error.meta?.target ?? "");
    return error.code === "P2021"
      || error.code === "P2022"
      || /userguidestate|guidekey|seenversion|dismissedat/i.test(target);
  }

  if (error instanceof Error) {
    return /UserGuideState|userguidestate|guideKey|seenVersion|dismissedAt/i.test(error.message);
  }

  return false;
}

function warnMissingUserGuideStateStore() {
  if (warnedMissingUserGuideStateStore) return;
  warnedMissingUserGuideStateStore = true;
  console.warn("[user-guide] UserGuideState store is missing. Run prisma db push.");
}

function defaultDashboardManualState(): DashboardManualGuideState {
  return {
    version: DASHBOARD_MANUAL_VERSION,
    dismissedAt: null,
    shouldAutoOpen: true,
  };
}

export async function getDashboardManualGuideState(userId: string): Promise<DashboardManualGuideState> {
  try {
    const guide = await prisma.userGuideState.findUnique({
      where: {
        userId_guideKey: {
          userId,
          guideKey: DASHBOARD_MANUAL_GUIDE_KEY,
        },
      },
      select: {
        seenVersion: true,
        dismissedAt: true,
      },
    });

    if (!guide) {
      return defaultDashboardManualState();
    }

    return {
      version: DASHBOARD_MANUAL_VERSION,
      dismissedAt: guide.dismissedAt.toISOString(),
      shouldAutoOpen: guide.seenVersion !== DASHBOARD_MANUAL_VERSION,
    };
  } catch (error) {
    if (isMissingUserGuideStateStoreError(error)) {
      warnMissingUserGuideStateStore();
      return defaultDashboardManualState();
    }
    throw error;
  }
}

export async function markDashboardManualGuideSeen(
  userId: string,
  seenVersion: typeof DASHBOARD_MANUAL_VERSION,
): Promise<DashboardManualGuideState> {
  const dismissedAt = new Date();

  await prisma.userGuideState.upsert({
    where: {
      userId_guideKey: {
        userId,
        guideKey: DASHBOARD_MANUAL_GUIDE_KEY,
      },
    },
    create: {
      userId,
      guideKey: DASHBOARD_MANUAL_GUIDE_KEY,
      seenVersion,
      dismissedAt,
    },
    update: {
      seenVersion,
      dismissedAt,
    },
  });

  return {
    version: DASHBOARD_MANUAL_VERSION,
    dismissedAt: dismissedAt.toISOString(),
    shouldAutoOpen: false,
  };
}
