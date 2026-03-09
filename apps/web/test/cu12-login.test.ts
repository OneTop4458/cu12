import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "12345678901234567890123456789012",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
  CU12_BASE_URL: "https://configured.example",
});

const { isCu12UnavailableResult, verifyCu12Login } = await import("../src/server/cu12-login");

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("verifyCu12Login retries against the fallback CU12 host", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) {
      throw new TypeError("fetch failed");
    }
    return new Response(JSON.stringify({ isError: false, message: "OK" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await verifyCu12Login({
    cu12Id: "student1",
    cu12Password: "password",
    campus: "SONGSIM",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /configured\.example/);
  assert.match(calls[1]!, /www\.cu12\.ac\.kr/);
});

test("verifyCu12Login returns an unavailable result after both hosts fail", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;

  const result = await verifyCu12Login({
    cu12Id: "student1",
    cu12Password: "password",
    campus: "SONGSIM",
  });

  assert.equal(isCu12UnavailableResult(result), true);
  assert.deepEqual(result, {
    ok: false,
    message: "CU12 login request failed",
    messageCode: "CU12_UNAVAILABLE",
  });
});

test("verifyCu12Login preserves upstream credential rejection details", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) {
      return new Response("not-json", { status: 200 });
    }
    return new Response(JSON.stringify({
      isError: true,
      message: "Invalid CU12 credentials",
      messageCode: "INVALID_CREDENTIALS",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await verifyCu12Login({
    cu12Id: "student1",
    cu12Password: "wrong-password",
    campus: "SONGSIM",
  });

  assert.equal(result.ok, false);
  assert.equal(result.messageCode, "INVALID_CREDENTIALS");
  assert.equal(isCu12UnavailableResult(result), false);
  assert.equal(calls.length, 2);
});
