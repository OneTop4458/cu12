import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "12345678901234567890123456789012",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
  CYBER_CAMPUS_BASE_URL: "https://e-cyber.example",
});

const {
  isCyberCampusUnavailableResult,
  verifyCyberCampusLogin,
} = await import("../src/server/cyber-campus-login");

const originalFetch = globalThis.fetch;

function makeResponse(body: string, options: {
  status?: number;
  url: string;
  headers?: Record<string, string>;
}) {
  const response = new Response(body, {
    status: options.status ?? 200,
    headers: options.headers,
  });
  Object.defineProperty(response, "url", {
    value: options.url,
    configurable: true,
  });
  return response;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("verifyCyberCampusLogin returns success when login reaches main form", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/ilos/main/member/login_form.acl")) {
      return makeResponse("<form><input id='usr_id'><input id='usr_pwd'><button id='login_btn'></button></form>", {
        url,
      });
    }
    return makeResponse("<a href='/ilos/lo/logout.acl'>logout</a>", {
      url: "https://e-cyber.example/ilos/main/main_form.acl",
    });
  }) as typeof fetch;

  const result = await verifyCyberCampusLogin({
    cu12Id: "student1",
    cu12Password: "password",
  });

  assert.deepEqual(result, {
    ok: true,
    message: "OK",
  });
  assert.deepEqual(calls, [
    "GET https://e-cyber.example/ilos/main/member/login_form.acl",
    "POST https://e-cyber.example/ilos/lo/login.acl",
  ]);
});

test("verifyCyberCampusLogin returns AUTH_FAILED when login falls back to login form", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/ilos/main/member/login_form.acl")) {
      return makeResponse("<form><input id='usr_id'><input id='usr_pwd'><button id='login_btn'></button></form>", {
        url,
      });
    }
    return makeResponse("<form><input id='usr_id'><input id='usr_pwd'><button id='login_btn'></button></form>", {
      url: "https://e-cyber.example/ilos/main/member/login_form.acl",
    });
  }) as typeof fetch;

  const result = await verifyCyberCampusLogin({
    cu12Id: "student1",
    cu12Password: "wrong",
  });

  assert.equal(result.ok, false);
  assert.equal(result.messageCode, "AUTH_FAILED");
  assert.equal(result.message, "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uACC4\uC815 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
});

test("verifyCyberCampusLogin returns unavailable on network failure", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("network down");
  }) as typeof fetch;

  const result = await verifyCyberCampusLogin({
    cu12Id: "student1",
    cu12Password: "password",
  });

  assert.equal(isCyberCampusUnavailableResult(result), true);
  assert.deepEqual(result, {
    ok: false,
    message: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778 \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    messageCode: "CYBER_CAMPUS_UNAVAILABLE",
  });
});
