import { JobStatus } from "@prisma/client";
import { prisma } from "./prisma";

const AUDIT_RETENTION_DAYS = 30;
const JOB_RETENTION_DAYS = 14;
const MAIL_RETENTION_DAYS = 30;
const WITHDRAWN_RECORD_RETENTION_MONTHS = 6;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function monthsAgo(months: number): Date {
  const value = new Date();
  value.setMonth(value.getMonth() - months);
  return value;
}

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
      message: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

async function main() {
  const auditCutoff = daysAgo(AUDIT_RETENTION_DAYS);
  const jobCutoff = daysAgo(JOB_RETENTION_DAYS);
  const mailCutoff = daysAgo(MAIL_RETENTION_DAYS);
  const withdrawnRecordCutoff = monthsAgo(WITHDRAWN_RECORD_RETENTION_MONTHS);
  const failures: string[] = [];

  const auditDeleted = await runCleanupStep("delete-old-audit-logs", () =>
    prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: auditCutoff },
      },
    }), failures);

  const jobsDeleted = await runCleanupStep("delete-terminal-jobs", () =>
    prisma.jobQueue.deleteMany({
      where: {
        status: {
          in: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED],
        },
        updatedAt: { lt: jobCutoff },
      },
    }), failures);

  const mailDeleted = await runCleanupStep("delete-old-mail-deliveries", () =>
    prisma.mailDelivery.deleteMany({
      where: {
        createdAt: { lt: mailCutoff },
      },
    }), failures);

  const withdrawnConsentsDeleted = await runCleanupStep("delete-withdrawn-policy-consents", () =>
    prisma.userPolicyConsent.deleteMany({
      where: {
        user: {
          withdrawnAt: {
            not: null,
            lt: withdrawnRecordCutoff,
          },
        },
      },
    }), failures);

  const withdrawnUsersDeleted = await runCleanupStep("delete-withdrawn-users", () =>
    prisma.user.deleteMany({
      where: {
        isActive: false,
        withdrawnAt: {
          not: null,
          lt: withdrawnRecordCutoff,
        },
      },
    }), failures);

  console.log(JSON.stringify({
    ok: failures.length === 0,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    jobRetentionDays: JOB_RETENTION_DAYS,
    mailRetentionDays: MAIL_RETENTION_DAYS,
    withdrawnRecordRetentionMonths: WITHDRAWN_RECORD_RETENTION_MONTHS,
    deleted: {
      auditLogs: auditDeleted,
      jobQueue: jobsDeleted,
      mailDeliveries: mailDeleted,
      withdrawnConsents: withdrawnConsentsDeleted,
      withdrawnUsers: withdrawnUsersDeleted,
    },
    failures,
  }));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
