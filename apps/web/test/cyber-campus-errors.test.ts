import assert from "node:assert/strict";
import test from "node:test";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_JWT_SECRET: "12345678901234567890123456789012",
  APP_MASTER_KEY: "12345678901234567890123456789012",
  WORKER_SHARED_TOKEN: "12345678901234567890123456789012",
});

const {
  CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE,
  normalizeCyberCampusTransportError,
} = await import("../src/server/cyber-campus-errors");

test("normalizeCyberCampusTransportError maps legacy TLS fetch failure to 503", () => {
  const cause = Object.assign(
    new Error("unsafe legacy renegotiation disabled"),
    { code: "ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED" },
  );
  const error = new TypeError("fetch failed") as TypeError & { cause?: unknown };
  error.cause = cause;

  const normalized = normalizeCyberCampusTransportError(error);

  assert.deepEqual(normalized, {
    status: 503,
    errorCode: "PORTAL_UNAVAILABLE",
    message: CYBER_CAMPUS_PORTAL_UNAVAILABLE_MESSAGE,
    details: {
      name: "TypeError",
      message: "fetch failed",
      causeName: "Error",
      causeCode: "ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED",
      causeMessage: "unsafe legacy renegotiation disabled",
    },
  });
});

test("normalizeCyberCampusTransportError ignores unrelated errors", () => {
  const normalized = normalizeCyberCampusTransportError(new Error("validation failed"));
  assert.equal(normalized, null);
});
