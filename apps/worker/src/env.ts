import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_MASTER_KEY: z.string().min(32),
  WEB_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3000"),
  WORKER_SHARED_TOKEN: z.string().min(16),
  WORKER_ID: z.string().optional(),
  CU12_BASE_URL: z.string().url().default("https://www.cu12.ac.kr"),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  AUTOLEARN_TIME_FACTOR: z.coerce.number().default(1),
  AUTOLEARN_MAX_TASKS: z.coerce.number().int().min(1).max(50).default(3),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | null = null;

export function getEnv(): WorkerEnv {
  if (!cached) {
    cached = EnvSchema.parse(process.env);
  }
  return cached;
}
