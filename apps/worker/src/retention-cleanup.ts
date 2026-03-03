import { JobStatus } from "@prisma/client";
import { prisma } from "./prisma";

const AUDIT_RETENTION_DAYS = 30;
const JOB_RETENTION_DAYS = 14;
const MAIL_RETENTION_DAYS = 30;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const auditCutoff = daysAgo(AUDIT_RETENTION_DAYS);
  const jobCutoff = daysAgo(JOB_RETENTION_DAYS);
  const mailCutoff = daysAgo(MAIL_RETENTION_DAYS);

  const [auditDeleted, jobsDeleted, mailDeleted] = await Promise.all([
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
  ]);

  console.log(JSON.stringify({
    ok: true,
    auditRetentionDays: AUDIT_RETENTION_DAYS,
    jobRetentionDays: JOB_RETENTION_DAYS,
    mailRetentionDays: MAIL_RETENTION_DAYS,
    deleted: {
      auditLogs: auditDeleted.count,
      jobQueue: jobsDeleted.count,
      mailDeliveries: mailDeleted.count,
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
