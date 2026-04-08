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
    "ID \uB610\uB294 \uBE44\uBC00\uBC88\uD638\uAC00 \uC77C\uCE58\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
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
