import assert from "node:assert/strict";
import test from "node:test";
import { extractCu12CsrfRequestHeaders } from "./cu12-http-sync";

test("CU12 roster request uses the CSRF header embedded in the form page", () => {
  const html = `
    <script>
      let xToken = 'test-token_123';
      const xHeader = 'X-CSRF-TOKEN';
    </script>
  `;

  assert.deepEqual(extractCu12CsrfRequestHeaders(html), {
    "X-CSRF-TOKEN": "test-token_123",
  });
});

test("CU12 roster request omits incomplete CSRF configuration", () => {
  assert.deepEqual(extractCu12CsrfRequestHeaders("<main></main>"), {});
  assert.deepEqual(extractCu12CsrfRequestHeaders("<script>let xToken = 'token';</script>"), {});
});
