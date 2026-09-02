import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { PortalProvider } from "@cu12/core";
import { NextRequest } from "next/server";
import { createAttentionCountHandler } from "../app/api/dashboard/activity/attention-count/handler";
import type { RequestAuthContext } from "../src/lib/http";

const request = new NextRequest("https://example.test/api/dashboard/activity/attention-count");
const authContext: RequestAuthContext = {
  actor: { userId: "user-count", email: "user@example.test", role: "USER" },
  effective: { userId: "user-count", email: "user@example.test", role: "USER" },
  impersonating: false,
};

function silenceConsoleError(t: TestContext) {
  const original = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = original;
  });
}

test("attention count 401 responses are no-store", async () => {
  const handler = createAttentionCountHandler({
    authenticate: async () => null,
    countProvider: async () => 0,
  });

  const response = await handler(request);
  const body = await response.json() as { error: string };

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.error, "Unauthorized");
});

test("attention count 200 responses are no-store", async () => {
  const handler = createAttentionCountHandler({
    authenticate: async () => authContext,
    countProvider: async (_userId: string, provider: PortalProvider) => provider === "CU12" ? 2 : 3,
  });

  const response = await handler(request);
  const body = await response.json() as { attentionCount: number };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.attentionCount, 5);
});

test("attention count 503 responses are no-store", async (t) => {
  silenceConsoleError(t);
  const handler = createAttentionCountHandler({
    authenticate: async () => authContext,
    countProvider: async () => {
      throw new Error("dependency failed");
    },
  });

  const response = await handler(request);
  const body = await response.json() as { error: string; errorCode: string };

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.error, "Dashboard activity attention count failed.");
  assert.equal(body.errorCode, "DASHBOARD_ACTIVITY_COUNT_FAILED");
});
