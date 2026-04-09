import assert from "node:assert/strict";
import test from "node:test";
import { buildPolicyDiffLines } from "../src/server/policy-diff";

test("buildPolicyDiffLines marks removed and added lines", () => {
  const diff = buildPolicyDiffLines(
    ["line-a", "line-b", "line-c"].join("\n"),
    ["line-a", "line-b2", "line-c", "line-d"].join("\n"),
  );

  assert.deepEqual(
    diff.filter((line) => line.kind !== "unchanged"),
    [
      { kind: "removed", text: "line-b" },
      { kind: "added", text: "line-b2" },
      { kind: "added", text: "line-d" },
    ],
  );
});
