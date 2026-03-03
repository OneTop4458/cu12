import { JobType } from "@prisma/client";
import { chromium } from "playwright";
import { claimJob, failJob, finishJob, sendHeartbeat } from "./internal-api";
import { collectCu12Snapshot, runAutoLearning } from "./cu12-automation";
import { getEnv } from "./env";
import {
  getUserCu12Credentials,
  markAccountConnected,
  markAccountNeedsReauth,
  persistSnapshot,
  recordLearningRun,
} from "./sync-store";
import { prisma } from "./prisma";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function processSync(userId: string) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const snapshot = await collectCu12Snapshot(browser, userId, creds);
    await persistSnapshot(userId, snapshot);
    await markAccountConnected(userId);

    return {
      type: "SYNC",
      courses: snapshot.courses.length,
      notices: snapshot.notices.length,
      notifications: snapshot.notifications.length,
      tasks: snapshot.tasks.length,
    };
  } catch (error) {
    const message = errMessage(error);
    if (/login|Unauthorized|need/i.test(message)) {
      await markAccountNeedsReauth(userId, message);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

async function processAutolearn(userId: string, lectureSeq?: number) {
  const creds = await getUserCu12Credentials(userId);
  if (!creds) {
    throw new Error("CU12 account is not configured for this user");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const autoResult = await runAutoLearning(browser, userId, creds, lectureSeq);
    await recordLearningRun(userId, lectureSeq ?? null, "SUCCESS", `watched=${autoResult.watchedTaskCount}`);

    // Refresh snapshots after playback updates.
    const snapshot = await collectCu12Snapshot(browser, userId, creds);
    await persistSnapshot(userId, snapshot);

    return {
      type: "AUTOLEARN",
      watchedTaskCount: autoResult.watchedTaskCount,
      watchedSeconds: autoResult.watchedSeconds,
      lectureSeqs: autoResult.lectureSeqs,
    };
  } catch (error) {
    await recordLearningRun(userId, lectureSeq ?? null, "FAILED", errMessage(error));
    throw error;
  } finally {
    await browser.close();
  }
}

async function processMailDigest(userId: string) {
  return { type: "MAIL_DIGEST", userId, queued: false };
}

async function main() {
  const env = getEnv();
  const once = process.argv.includes("--once");
  const workerId = env.WORKER_ID ?? `worker-${process.pid}`;

  while (true) {
    try {
      await sendHeartbeat(workerId);
      const job = await claimJob(workerId, [JobType.SYNC, JobType.AUTOLEARN, JobType.NOTICE_SCAN, JobType.MAIL_DIGEST]);

      if (!job) {
        if (once) break;
        await sleep(env.POLL_INTERVAL_MS);
        continue;
      }

      try {
        let result: unknown;
        if (job.type === JobType.SYNC || job.type === JobType.NOTICE_SCAN) {
          result = await processSync(job.payload.userId);
        } else if (job.type === JobType.AUTOLEARN) {
          result = await processAutolearn(job.payload.userId, job.payload.lectureSeq);
        } else {
          result = await processMailDigest(job.payload.userId);
        }

        await finishJob(job.id, result);
      } catch (jobError) {
        await failJob(job.id, errMessage(jobError));
      }

    } catch (loopError) {
      if (once) {
        throw loopError;
      }
      await sleep(env.POLL_INTERVAL_MS);
    }
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
