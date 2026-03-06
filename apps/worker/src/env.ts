import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_MASTER_KEY: z.string().min(32),
  WEB_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3000"),
  WORKER_SHARED_TOKEN: z.string().min(16),
  WORKER_ID: z.string().optional(),
  CU12_BASE_URL: z.string().url().default("https://www.cu12.ac.kr"),
  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_USER_AGENT: z.string().optional(),
  PLAYWRIGHT_LOCALE: z.string().default("ko-KR"),
  PLAYWRIGHT_TIMEZONE: z.string().default("Asia/Seoul"),
  PLAYWRIGHT_VIEWPORT_WIDTH: z.coerce.number().int().min(800).max(5000).default(1366),
  PLAYWRIGHT_VIEWPORT_HEIGHT: z.coerce.number().int().min(600).max(5000).default(768),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  WORKER_INTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  WORKER_INTERNAL_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  WORKER_INTERNAL_API_RETRY_BASE_MS: z.coerce.number().int().min(200).max(10000).default(1000),
  WORKER_ONCE_IDLE_GRACE_MS: z.coerce.number().int().min(10000).max(300000).default(60000),
  AUTOLEARN_TIME_FACTOR: z.coerce.number().default(1),
  AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  AUTOLEARN_STALL_TIMEOUT_SECONDS: z.coerce.number().int().min(120).max(7200).default(1200),
  AUTOLEARN_MAX_TASKS: z.coerce.number().int().min(1).max(200).default(50),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | null = null;

export function getEnv(): WorkerEnv {
  if (!cached) {
    cached = EnvSchema.parse(process.env);
  }
  return cached;
}
