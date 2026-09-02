import { JobStatus } from "@prisma/client";
import { prisma } from "./prisma";
import {
  AUDIT_RETENTION_DAYS,
  buildExpiredPortalApprovalWhere,
  buildExpiredPortalSessionWhere,
  buildRetentionCutoffs,
  JOB_RETENTION_DAYS,
  MAIL_RETENTION_DAYS,
  PORTAL_APPROVAL_RETENTION_DAYS,
  WITHDRAWN_RECORD_RETENTION_MONTHS,
} from "./retention-policy";

async function runCleanupStep(
  step: string,
  work: () => Promise<{ count: number }>,
  failures: string[],
): Promise<number> {
  try {
    const result = await work();
    return result.count;
  } catch (error) {
    const errorRecord = error && typeof error === "object"
      ? error as { code?: unknown }
      : {};
    failures.push(step);
    console.error("[retention] cleanup step failed", {
      step,
      name: error instanceof Error ? error.name : typeof error,
      code: typeof errorRecord.code === "string" ? errorRecord.code : null,
    });
    return 0;
  }
}

type RetentionPrismaClient = Pick<
  typeof prisma,
  | "auditLog"
  | "jobQueue"
  | "mailDelivery"
  | "portalSession"
  | "portalApprovalSession"
  | "userPolicyConsent"
  | "user"
>;

export async function runRetentionCleanup(
  client: RetentionPrismaClient,
  now = new Date(),
) {
  const cutoffs = buildRetentionCutoffs(now);
  const failures: string[] = [];

  const auditDeleted = await runCleanupStep("delete-old-audit-logs", () =>
    client.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffs.audit },
      },
    }), failures);

  const jobsDeleted = await runCleanupStep("delete-terminal-jobs", () =>
    client.jobQueue.deleteMany({
      where: {
        status: {
          in: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED],
        },
        updatedAt: { lt: cutoffs.job },
      },
    }), failures);

  const mailDeleted = await runCleanupStep("delete-old-mail-deliveries", () =>
    client.mailDelivery.deleteMany({
      where: {
        createdAt: { lt: cutoffs.mail },
      },
    }), failures);

  const portalSessionsDeleted = await runCleanupStep("delete-expired-portal-sessions", () =>
    client.portalSession.deleteMany({
      where: buildExpiredPortalSessionWhere(now),
    }), failures);

  const portalApprovalSessionsDeleted = await runCleanupStep("delete-old-terminal-portal-approvals", () =>
    client.portalApprovalSession.deleteMany({
      where: buildExpiredPortalApprovalWhere(now),
    }), failures);

  const withdrawnConsentsDeleted = await runCleanupStep("delete-withdrawn-policy-consents", () =>
    client.userPolicyConsent.deleteMany({
      where: {
        user: {
          withdrawnAt: {
            not: null,
            lt: cutoffs.withdrawnRecord,
          },
        },
      },
    }), failures);

  const withdrawnUsersDeleted = await runCleanupStep("delete-withdrawn-users", () =>
    client.user.deleteMany({
      where: {
        isActive: false,
        withdrawnAt: {
          not: null,
          lt: cutoffs.withdrawnRecord,
        },
      },
    }), failures);

  return {
    ok: failures.length === 0,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    jobRetentionDays: JOB_RETENTION_DAYS,
    mailRetentionDays: MAIL_RETENTION_DAYS,
    portalApprovalRetentionDays: PORTAL_APPROVAL_RETENTION_DAYS,
    withdrawnRecordRetentionMonths: WITHDRAWN_RECORD_RETENTION_MONTHS,
    deleted: {
      auditLogs: auditDeleted,
      jobQueue: jobsDeleted,
      mailDeliveries: mailDeleted,
      portalSessions: portalSessionsDeleted,
      portalApprovalSessions: portalApprovalSessionsDeleted,
      withdrawnConsents: withdrawnConsentsDeleted,
      withdrawnUsers: withdrawnUsersDeleted,
    },
    failures,
  };
}

async function main() {
  const result = await runRetentionCleanup(prisma);
  console.log(JSON.stringify(result));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    const errorRecord = error && typeof error === "object"
      ? error as { code?: unknown }
      : {};
    console.error("[retention] fatal cleanup error", {
      name: error instanceof Error ? error.name : typeof error,
      code: typeof errorRecord.code === "string" ? errorRecord.code : null,
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
