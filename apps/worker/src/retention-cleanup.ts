import { JobStatus } from "@prisma/client";
import { prisma } from "./prisma";

const AUDIT_RETENTION_DAYS = 30;
const JOB_RETENTION_DAYS = 14;
const MAIL_RETENTION_DAYS = 30;
const WITHDRAWN_CONSENT_RETENTION_YEARS = 3;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function yearsAgo(years: number): Date {
  const value = new Date();
  value.setFullYear(value.getFullYear() - years);
  return value;
}

async function main() {
  const auditCutoff = daysAgo(AUDIT_RETENTION_DAYS);
  const jobCutoff = daysAgo(JOB_RETENTION_DAYS);
  const mailCutoff = daysAgo(MAIL_RETENTION_DAYS);
  const withdrawnConsentCutoff = yearsAgo(WITHDRAWN_CONSENT_RETENTION_YEARS);

  const [auditDeleted, jobsDeleted, mailDeleted, withdrawnConsentsDeleted] = await Promise.all([
    prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: auditCutoff },
      },
    }),
    prisma.jobQueue.deleteMany({
      where: {
        status: {
          in: [JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED],
        },
        updatedAt: { lt: jobCutoff },
      },
    }),
    prisma.mailDelivery.deleteMany({
      where: {
        createdAt: { lt: mailCutoff },
      },
    }),
    prisma.userPolicyConsent.deleteMany({
      where: {
        user: {
          withdrawnAt: {
            not: null,
            lt: withdrawnConsentCutoff,
          },
        },
      },
    }),
  ]);

  console.log(JSON.stringify({
    ok: true,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    jobRetentionDays: JOB_RETENTION_DAYS,
    mailRetentionDays: MAIL_RETENTION_DAYS,
    withdrawnConsentRetentionYears: WITHDRAWN_CONSENT_RETENTION_YEARS,
    deleted: {
      auditLogs: auditDeleted.count,
      jobQueue: jobsDeleted.count,
      mailDeliveries: mailDeleted.count,
      withdrawnConsents: withdrawnConsentsDeleted.count,
    },
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
