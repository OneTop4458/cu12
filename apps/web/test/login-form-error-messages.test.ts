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
      error: "\uB85C\uADF8\uC778 \uC11C\uBE44\uC2A4\uC5D0 \uC77C\uC2DC\uC801\uC73C\uB85C \uC811\uC18D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
    }),
    "\uB85C\uADF8\uC778 \uC11C\uBE44\uC2A4\uC5D0 \uC77C\uC2DC\uC801\uC73C\uB85C \uC811\uC18D\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  );
});

test("toLoginErrorMessage surfaces Cyber Campus unavailability", () => {
  assert.equal(
    toLoginErrorMessage({
      errorCode: "CYBER_CAMPUS_UNAVAILABLE",
      error: "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778 \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    }),
    "\uC0AC\uC774\uBC84\uCEA0\uD37C\uC2A4 \uB85C\uADF8\uC778 \uC694\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  );
});

test("toInviteErrorMessage handles invite verification failures", () => {
  assert.equal(
    toInviteErrorMessage({
      errorCode: "INVITE_VERIFICATION_FAILED",
      error: "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    }),
    "\uCD08\uB300 \uCF54\uB4DC \uD655\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  );
});

test("toConsentErrorMessage uses the internal error payload", () => {
  assert.equal(
    toConsentErrorMessage({
      errorCode: "INTERNAL_ERROR",
      error: "\uC57D\uAD00 \uB3D9\uC758 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
    }),
    "\uC57D\uAD00 \uB3D9\uC758 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  );
});
