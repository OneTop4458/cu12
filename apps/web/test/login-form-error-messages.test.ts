import assert from "node:assert/strict";
import test from "node:test";
import {
  toConsentErrorMessage,
  toInviteErrorMessage,
  toLoginErrorMessage,
} from "../app/login/login-form";

test("toLoginErrorMessage maps AUTH_FAILED to the credential mismatch copy", () => {
  assert.equal(
    toLoginErrorMessage({ errorCode: "AUTH_FAILED" }),
    "ID 또는 비밀번호가 일치하지 않습니다.",
  );
});

test("toLoginErrorMessage surfaces CU12 unavailability", () => {
  assert.equal(
    toLoginErrorMessage({
      errorCode: "CU12_UNAVAILABLE",
      error: "Authentication service unavailable.",
    }),
    "Authentication service unavailable.",
  );
});

test("toInviteErrorMessage handles invite verification failures", () => {
  assert.equal(
    toInviteErrorMessage({
      errorCode: "INVITE_VERIFICATION_FAILED",
      error: "Invite verification failed.",
    }),
    "Invite verification failed.",
  );
});

test("toConsentErrorMessage uses the internal error payload", () => {
  assert.equal(
    toConsentErrorMessage({
      errorCode: "INTERNAL_ERROR",
      error: "Policy consent failed.",
    }),
    "Policy consent failed.",
  );
});
