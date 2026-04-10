import assert from "node:assert/strict";
import test from "node:test";
import { interpretCyberCampusTaskAccessState } from "./cyber-campus-auth-state";

test("interpretCyberCampusTaskAccessState trusts ready secondary-auth checks over submain redirects", () => {
  const result = interpretCyberCampusTaskAccessState({
    ready: true,
    message: null,
    messageCode: null,
    secondaryAuthBlocked: false,
    pageUrl: "https://e-cyber.catholic.ac.kr/ilos/st/course/submain_form.acl",
  });

  assert.equal(result, "READY");
});

test("interpretCyberCampusTaskAccessState treats confirmed-secondary-auth responses as approval-required", () => {
  const result = interpretCyberCampusTaskAccessState({
    ready: false,
    message: null,
    messageCode: "E_CONFIRMED_SECONDARY_AUTH",
    secondaryAuthBlocked: false,
    pageUrl: "https://e-cyber.catholic.ac.kr/ilos/st/course/online_view.acl",
  });

  assert.equal(result, "SECONDARY_AUTH_REQUIRED");
});

test("interpretCyberCampusTaskAccessState treats approval dialogs as approval-required", () => {
  const result = interpretCyberCampusTaskAccessState({
    ready: false,
    message: null,
    messageCode: null,
    secondaryAuthBlocked: true,
    pageUrl: "https://e-cyber.catholic.ac.kr/ilos/st/course/online_view.acl",
  });

  assert.equal(result, "SECONDARY_AUTH_REQUIRED");
});

test("interpretCyberCampusTaskAccessState treats Korean auth-required messages as approval-required", () => {
  const result = interpretCyberCampusTaskAccessState({
    ready: false,
    message: "\uBCF8\uC778\uC778\uC99D \uD6C4\uC5D0 \uC774\uC6A9\uD558\uC2E4\uC218 \uC788\uC2B5\uB2C8\uB2E4.",
    messageCode: null,
    secondaryAuthBlocked: false,
    pageUrl: "https://e-cyber.catholic.ac.kr/ilos/st/course/online_view.acl",
  });

  assert.equal(result, "SECONDARY_AUTH_REQUIRED");
});
