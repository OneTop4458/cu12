export interface PlaybackTick {
  elapsedSeconds: number;
  remainingSeconds: number;
}

export function shouldReportPlaybackProgress(elapsedSeconds: number, previousSeconds: number, intervalSeconds: number, remainingSeconds: number): boolean {
  return remainingSeconds <= 0 || elapsedSeconds - previousSeconds >= intervalSeconds;
}

interface PlaybackWaitOptions {
  waitSeconds: number;
  wait: (milliseconds: number) => Promise<void>;
  shouldCancel: () => Promise<boolean>;
  onTick?: (tick: PlaybackTick) => Promise<void> | void;
  nextTickMs: () => number;
  now?: () => number;
}

export async function waitForPlaybackDuration(options: PlaybackWaitOptions): Promise<void> {
  let remainingMs = Math.max(0, options.waitSeconds * 1000);
  const totalMs = remainingMs;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + totalMs;
  while (remainingMs > 0) {
    if (await options.shouldCancel()) throw new Error("AUTOLEARN_CANCELLED");
    remainingMs = Math.max(0, deadline - now());
    if (remainingMs > 0) await options.wait(Math.min(options.nextTickMs(), remainingMs));
    // The player stays open during status reads and progress callbacks too.
    remainingMs = Math.max(0, deadline - now());
    await options.onTick?.({
      elapsedSeconds: Math.floor((totalMs - remainingMs) / 1000),
      remainingSeconds: Math.ceil(remainingMs / 1000),
    });
  }
}
