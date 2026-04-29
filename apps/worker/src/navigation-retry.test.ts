import assert from "node:assert/strict";
import test from "node:test";
import {
  getNavigationRetryDelayMs,
  gotoWithRetry,
  isRetryableNavigationError,
} from "./navigation-retry";

function createPageStub(failures: unknown[]) {
  const calls: Array<{ url: string; timeout: number | undefined }> = [];
  return {
    calls,
    page: {
      goto: async (url: string, options?: { timeout?: number }) => {
        calls.push({ url, timeout: options?.timeout });
        const failure = failures.shift();
        if (failure) throw failure;
        return null;
      },
    },
  };
}

test("gotoWithRetry retries net::ERR_TIMED_OUT and returns after a later success", async () => {
  const { page, calls } = createPageStub([
    new Error("page.goto: net::ERR_TIMED_OUT at https://example.test"),
  ]);
  const delays: number[] = [];

  await gotoWithRetry(page as never, "https://example.test", { waitUntil: "domcontentloaded" }, {
    retries: 2,
    retryBaseMs: 5_000,
    timeoutMs: 120_000,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [5_000]);
  assert.equal(calls[0]?.timeout, 120_000);
});

test("gotoWithRetry preserves the final retryable navigation error", async () => {
  const finalError = new Error("page.goto: net::ERR_TIMED_OUT at https://example.test");
  const { page } = createPageStub([
    new Error("page.goto: net::ERR_TIMED_OUT at https://example.test"),
    finalError,
  ]);

  try {
    await gotoWithRetry(page as never, "https://example.test", {}, {
      retries: 1,
      retryBaseMs: 5_000,
      timeoutMs: 120_000,
      sleep: async () => {},
    });
    assert.fail("Expected gotoWithRetry to reject");
  } catch (error) {
    assert.equal(error, finalError);
  }
});

test("gotoWithRetry does not retry non-navigation errors", async () => {
  const { page, calls } = createPageStub([new Error("Selector not found")]);

  await assert.rejects(
    () => gotoWithRetry(page as never, "https://example.test", {}, {
      retries: 2,
      retryBaseMs: 5_000,
      timeoutMs: 120_000,
      sleep: async () => {},
    }),
    /Selector not found/,
  );

  assert.equal(calls.length, 1);
});

test("navigation retry classifier and delay keep the intended defaults", () => {
  assert.equal(isRetryableNavigationError(new Error("Navigation timeout of 30000 ms exceeded")), true);
  assert.equal(isRetryableNavigationError(new Error("page.goto: net::ERR_CONNECTION_RESET")), true);
  assert.equal(isRetryableNavigationError(new Error("Locator timeout exceeded")), false);
  assert.equal(getNavigationRetryDelayMs(1, 5_000), 5_000);
  assert.equal(getNavigationRetryDelayMs(2, 5_000), 15_000);
});
