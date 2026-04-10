import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRestoredCyberCampusSessionCookieState,
  resolveReusableCyberCampusSessionOptions,
} from "./cyber-campus-session-options";

test("resolveReusableCyberCampusSessionOptions reuses active non-expired cookie state", () => {
  const result = resolveReusableCyberCampusSessionOptions({
    status: "ACTIVE",
    expiresAt: new Date("2026-04-10T12:00:00+09:00"),
    cookieState: [{ name: "JSESSIONID", value: "abc" }],
  }, Date.parse("2026-04-10T11:00:00+09:00"));

  assert.deepEqual(result, {
    cookieState: [{ name: "JSESSIONID", value: "abc" }],
  });
});

test("resolveReusableCyberCampusSessionOptions falls back to fresh login when session is invalid", () => {
  const result = resolveReusableCyberCampusSessionOptions({
    status: "INVALID",
    expiresAt: new Date("2026-04-10T12:00:00+09:00"),
    cookieState: [{ name: "JSESSIONID", value: "abc" }],
  }, Date.parse("2026-04-10T11:00:00+09:00"));

  assert.equal(result, undefined);
});

test("resolveReusableCyberCampusSessionOptions falls back to fresh login when session is expired", () => {
  const result = resolveReusableCyberCampusSessionOptions({
    status: "ACTIVE",
    expiresAt: new Date("2026-04-10T10:00:00+09:00"),
    cookieState: [{ name: "JSESSIONID", value: "abc" }],
  }, Date.parse("2026-04-10T11:00:00+09:00"));

  assert.equal(result, undefined);
});

test("resolveRestoredCyberCampusSessionCookieState preserves completed approval cookies after planning recovery", () => {
  const result = resolveRestoredCyberCampusSessionCookieState({
    retriedStoredSession: true,
    cookieState: [{ name: "JSESSIONID", value: "approved" }],
  });

  assert.deepEqual(result, [{ name: "JSESSIONID", value: "approved" }]);
});

test("resolveRestoredCyberCampusSessionCookieState skips restoration when planning did not refresh", () => {
  const result = resolveRestoredCyberCampusSessionCookieState({
    retriedStoredSession: false,
    cookieState: [{ name: "JSESSIONID", value: "approved" }],
  });

  assert.equal(result, undefined);
});
