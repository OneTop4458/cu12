import assert from "node:assert/strict";
import test from "node:test";
import { shouldReportPlaybackProgress, waitForPlaybackDuration, type PlaybackTick } from "./playback-clock";

test("cancellation-query latency counts toward the required player-open duration", async () => {
  let now = 0;
  let checks = 0;
  await waitForPlaybackDuration({
    waitSeconds: 60, now: () => now, nextTickMs: () => 1000,
    wait: async (milliseconds) => { now += milliseconds; },
    shouldCancel: async () => { checks += 1; now += 500; return false; },
  });
  assert.equal(now, 60_000, "60 seconds must not become 90 seconds by adding query time to every tick");
  assert.ok(checks < 60);
});

test("slow progress publication does not accumulate another full delay per tick", async () => {
  let now = 0;
  const ticks: PlaybackTick[] = [];
  await waitForPlaybackDuration({
    waitSeconds: 10, now: () => now, nextTickMs: () => 1000,
    wait: async (milliseconds) => { now += milliseconds; },
    shouldCancel: async () => { now += 100; return false; },
    onTick: async (tick) => { ticks.push(tick); now += 200; },
  });
  assert.ok(now >= 10_000 && now <= 10_300);
  assert.deepEqual(ticks.at(-1), { elapsedSeconds: 10, remainingSeconds: 0 });
});

test("a query that crosses the deadline does not add an unnecessary sleep", async () => {
  let now = 0;
  let sleeps = 0;
  await waitForPlaybackDuration({
    waitSeconds: 10, now: () => now, nextTickMs: () => 1000,
    wait: async () => { sleeps += 1; },
    shouldCancel: async () => { now += 15_000; return false; },
  });
  assert.equal(now, 15_000);
  assert.equal(sleeps, 0);
});

test("cancellation still stops the wait before completion", async () => {
  let now = 0;
  let checks = 0;
  await assert.rejects(waitForPlaybackDuration({
    waitSeconds: 60, now: () => now, nextTickMs: () => 1000,
    wait: async (milliseconds) => { now += milliseconds; },
    shouldCancel: async () => ++checks === 3,
  }), /AUTOLEARN_CANCELLED/);
  assert.equal(now, 2000);
});

test("progress still publishes when network delay jumps over an exact interval boundary", () => {
  assert.equal(shouldReportPlaybackProgress(59, 0, 60, 300), false);
  assert.equal(shouldReportPlaybackProgress(61, 0, 60, 300), true);
  assert.equal(shouldReportPlaybackProgress(62, 61, 60, 299), false);
  assert.equal(shouldReportPlaybackProgress(122, 61, 60, 239), true);
  assert.equal(shouldReportPlaybackProgress(122, 122, 60, 0), true);
});
