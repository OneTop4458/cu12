import assert from "node:assert/strict";
import test from "node:test";
import { resolveSyncProviders } from "@cu12/core";

test("resolveSyncProviders returns both providers when CU12 campus is known", () => {
  assert.deepEqual(resolveSyncProviders("SONGSIM"), ["CU12", "CYBER_CAMPUS"]);
  assert.deepEqual(resolveSyncProviders("SONGSIN"), ["CU12", "CYBER_CAMPUS"]);
});

test("resolveSyncProviders falls back to Cyber Campus only when campus is missing", () => {
  assert.deepEqual(resolveSyncProviders(null), ["CYBER_CAMPUS"]);
  assert.deepEqual(resolveSyncProviders(undefined), ["CYBER_CAMPUS"]);
});

test("resolveSyncProviders filters requested providers against available providers", () => {
  assert.deepEqual(resolveSyncProviders("SONGSIM", ["CYBER_CAMPUS"]), ["CYBER_CAMPUS"]);
  assert.deepEqual(resolveSyncProviders(null, ["CU12", "CYBER_CAMPUS"]), ["CYBER_CAMPUS"]);
});
