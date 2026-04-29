import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "../src/lib/http";

test("parseBody reports malformed JSON as a validation error", async () => {
  const request = new NextRequest("https://cu12.test/api/example", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{bad-json",
  });

  await assert.rejects(
    () => parseBody(request, z.object({ ok: z.boolean() })),
    (error) => {
      assert.ok(error instanceof z.ZodError);
      assert.equal(error.issues[0]?.message, "Invalid JSON payload");
      return true;
    },
  );
});
