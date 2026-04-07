import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_MASTER_KEY: z.string().min(32),
  WEB_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3000"),
  WORKER_SHARED_TOKEN: z.string().min(32),
  WORKER_ID: z.string().optional(),
  CU12_BASE_URL: z.string().url().default("https://www.cu12.ac.kr"),
  PLAYWRIGHT_HEADLESS: z.coerce.boolean().default(true),
  PLAYWRIGHT_USER_AGENT: z.string().optional(),
  PLAYWRIGHT_ACCEPT_LANGUAGE: z.string().default("ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"),
  PLAYWRIGHT_LOCALE: z.string().default("ko-KR"),
  PLAYWRIGHT_TIMEZONE: z.string().default("Asia/Seoul"),
  PLAYWRIGHT_VIEWPORT_WIDTH: z.coerce.number().int().min(800).max(5000).default(1366),
  PLAYWRIGHT_VIEWPORT_HEIGHT: z.coerce.number().int().min(600).max(5000).default(768),
  AUTOLEARN_HUMANIZATION_ENABLED: z.coerce.boolean().default(true),
  AUTOLEARN_DELAY_MIN_MS: z.coerce.number().int().min(50).max(3000).default(180),
  AUTOLEARN_DELAY_MAX_MS: z.coerce.number().int().min(100).max(5000).default(900),
  AUTOLEARN_NAV_SETTLE_MIN_MS: z.coerce.number().int().min(200).max(5000).default(600),
  AUTOLEARN_NAV_SETTLE_MAX_MS: z.coerce.number().int().min(300).max(7000).default(1800),
  AUTOLEARN_TYPING_DELAY_MIN_MS: z.coerce.number().int().min(10).max(300).default(40),
  AUTOLEARN_TYPING_DELAY_MAX_MS: z.coerce.number().int().min(20).max(500).default(120),
  POLL_INTERVAL_MS: z.coerce.number().default(30000),
  WORKER_INTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  WORKER_INTERNAL_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  WORKER_INTERNAL_API_RETRY_BASE_MS: z.coerce.number().int().min(200).max(10000).default(1000),
  WORKER_ONCE_IDLE_GRACE_MS: z.coerce.number().int().min(10000).max(300000).default(60000),
  AUTOLEARN_TIME_FACTOR: z.coerce.number().default(1),
  AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  AUTOLEARN_STALL_TIMEOUT_SECONDS: z.coerce.number().int().min(120).max(7200).default(1200),
  AUTOLEARN_CHUNK_TARGET_SECONDS: z.coerce.number().int().min(300).max(21600).default(5400),
  AUTOLEARN_MAX_TASKS: z.coerce.number().int().min(1).max(200).default(50),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
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
