import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSiteNoticeDisplayTargetLabel,
  isSiteNoticeVisibleOnSurface,
  normalizeSiteNoticeDisplayTarget,
} from "../src/lib/site-notice-display";

test("maintenance notices are always normalized to login and topbar", () => {
  assert.equal(normalizeSiteNoticeDisplayTarget("MAINTENANCE", "LOGIN"), "BOTH");
  assert.equal(normalizeSiteNoticeDisplayTarget("MAINTENANCE", "TOPBAR"), "BOTH");
  assert.equal(normalizeSiteNoticeDisplayTarget("MAINTENANCE", undefined), "BOTH");
});

test("login surface shows maintenance notices and login-targeted broadcast notices", () => {
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "LOGIN", surface: "LOGIN" }),
    true,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "BOTH", surface: "LOGIN" }),
    true,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "TOPBAR", surface: "LOGIN" }),
    false,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "MAINTENANCE", displayTarget: "TOPBAR", surface: "LOGIN" }),
    true,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "MAINTENANCE", displayTarget: "BOTH", surface: "LOGIN" }),
    true,
  );
});

test("topbar surface shows broadcast topbar notices and maintenance notices", () => {
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "TOPBAR", surface: "TOPBAR" }),
    true,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "BOTH", surface: "TOPBAR" }),
    true,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "BROADCAST", displayTarget: "LOGIN", surface: "TOPBAR" }),
    false,
  );
  assert.equal(
    isSiteNoticeVisibleOnSurface({ type: "MAINTENANCE", displayTarget: "LOGIN", surface: "TOPBAR" }),
    true,
  );
});

test("display target labels reflect broadcast options and fixed maintenance text", () => {
  assert.equal(formatSiteNoticeDisplayTargetLabel("BROADCAST", "LOGIN"), "로그인만");
  assert.equal(formatSiteNoticeDisplayTargetLabel("BROADCAST", "TOPBAR"), "상단만");
  assert.equal(formatSiteNoticeDisplayTargetLabel("BROADCAST", "BOTH"), "로그인+상단");
  assert.equal(formatSiteNoticeDisplayTargetLabel("MAINTENANCE", "BOTH"), "로그인+상단 고정");
});
