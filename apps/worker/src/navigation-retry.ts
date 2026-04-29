import type { Page, Response } from "playwright";
import { getEnv } from "./env";

type GotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;

export interface NavigationRetryOptions {
  retries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (input: { url: string; attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

const RETRYABLE_NETWORK_MARKERS = [
  "net::ERR_TIMED_OUT",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_CONNECTION_CLOSED",
  "net::ERR_CONNECTION_TIMED_OUT",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_ADDRESS_UNREACHABLE",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_TUNNEL_CONNECTION_FAILED",
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isRetryableNavigationError(error: unknown): boolean {
  const message = errorMessage(error);
  if (RETRYABLE_NETWORK_MARKERS.some((marker) => message.includes(marker))) {
    return true;
  }

  return /(?:page\.)?goto|navigat/i.test(message)
    && /timeout|timed out|Timeout \d+ms exceeded/i.test(message);
}

export function getNavigationRetryDelayMs(retryNumber: number, retryBaseMs: number): number {
  const safeRetryNumber = Math.max(1, Math.floor(retryNumber));
  return Math.max(0, retryBaseMs * ((safeRetryNumber * 2) - 1));
}

export async function gotoWithRetry(
  page: Page,
  url: string,
  options: GotoOptions = {},
  retryOptions: NavigationRetryOptions = {},
): Promise<Response | null> {
  let env: ReturnType<typeof getEnv> | null = null;
  const getWorkerEnv = () => {
    env ??= getEnv();
    return env;
  };
  const retries = retryOptions.retries ?? getWorkerEnv().PLAYWRIGHT_NAVIGATION_RETRIES;
  const retryBaseMs = retryOptions.retryBaseMs ?? getWorkerEnv().PLAYWRIGHT_NAVIGATION_RETRY_BASE_MS;
  const timeoutMs = retryOptions.timeoutMs ?? getWorkerEnv().PLAYWRIGHT_NAVIGATION_TIMEOUT_MS;
  const sleep = retryOptions.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, retries + 1);
  const gotoOptions: GotoOptions = {
    ...options,
    timeout: options.timeout ?? timeoutMs,
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await page.goto(url, gotoOptions);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableNavigationError(error)) {
        throw error;
      }

      const delayMs = getNavigationRetryDelayMs(attempt, retryBaseMs);
      retryOptions.onRetry?.({ url, attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
