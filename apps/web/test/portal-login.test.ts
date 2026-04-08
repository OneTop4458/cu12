import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "12345678901234567890123456789012",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
  CU12_BASE_URL: "https://configured-cu12.example",
  CYBER_CAMPUS_BASE_URL: "https://e-cyber.example",
});

const {
  isPortalUnavailableResult,
  verifyPortalLogin,
} = await import("../src/server/portal-login");

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

test("verifyPortalLogin routes CU12 provider to CU12 verifier", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify({ isError: false, message: "OK" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await verifyPortalLogin({
    provider: "CU12",
    cu12Id: "student1",
    cu12Password: "password",
    campus: "SONGSIM",
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /configured-cu12\.example/);
});

test("verifyPortalLogin routes Cyber Campus provider to Cyber Campus verifier", async () => {
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

  const result = await verifyPortalLogin({
    provider: "CYBER_CAMPUS",
    cu12Id: "student1",
    cu12Password: "password",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    "GET https://e-cyber.example/ilos/main/member/login_form.acl",
    "POST https://e-cyber.example/ilos/lo/login.acl",
  ]);
});

test("verifyPortalLogin preserves Cyber Campus auth failure results", async () => {
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

  const result = await verifyPortalLogin({
    provider: "CYBER_CAMPUS",
    cu12Id: "student1",
    cu12Password: "wrong",
  });

  assert.deepEqual(result, {
    ok: false,
    message: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uACC4\uC815 \uC815\uBCF4\uAC00 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
    messageCode: "AUTH_FAILED",
    verifiedProvider: "CYBER_CAMPUS",
  });
});

test("verifyPortalLogin falls back to Cyber Campus when no provider hint is given", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("configured-cu12.example")) {
      return new Response(JSON.stringify({ isError: true, message: "Invalid CU12 credentials" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/ilos/main/member/login_form.acl")) {
      return makeResponse("<form><input id='usr_id'><input id='usr_pwd'><button id='login_btn'></button></form>", {
        url,
      });
    }
    return makeResponse("<a href='/ilos/lo/logout.acl'>logout</a>", {
      url: "https://e-cyber.example/ilos/main/main_form.acl",
    });
  }) as typeof fetch;

  const result = await verifyPortalLogin({
    cu12Id: "student1",
    cu12Password: "password",
    campus: "SONGSIM",
  });

  assert.equal(result.ok, true);
  assert.equal(result.verifiedProvider, "CYBER_CAMPUS");
  assert.deepEqual(calls, [
    "POST https://configured-cu12.example/el/lo/hak_login_proc.acl",
    "GET https://e-cyber.example/ilos/main/member/login_form.acl",
    "POST https://e-cyber.example/ilos/lo/login.acl",
  ]);
});

test("isPortalUnavailableResult recognizes Cyber Campus unavailable result", () => {
  assert.equal(
    isPortalUnavailableResult({
      ok: false,
      message: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778 \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
      messageCode: "CYBER_CAMPUS_UNAVAILABLE",
    }),
    true,
  );
});
