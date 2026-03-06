import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_JWT_SECRET: z.string().min(32),
  APP_MASTER_KEY: z.string().min(32),
  WORKER_SHARED_TOKEN: z.string().min(32),
  TRUST_PROXY_HEADERS: z.coerce.boolean().default(false),
  CU12_BASE_URL: z.string().url().default("https://www.cu12.ac.kr"),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  GITHUB_WORKFLOW_ID: z.string().optional(),
  GITHUB_WORKFLOW_REF: z.string().default("main"),
  GITHUB_TOKEN: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = EnvSchema.parse(process.env);
  }
  return cachedEnv;
}
