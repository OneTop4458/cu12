type TimingEntry = {
  name: string;
  durationMs: number;
};

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export class ServerTiming {
  private readonly entries: TimingEntry[] = [];

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  record(name: string, durationMs: number) {
    this.entries.push({
      name: sanitizeName(name),
      durationMs: Math.max(0, durationMs),
    });
  }

  toHeaderValue(): string | null {
    if (this.entries.length === 0) {
      return null;
    }

    return this.entries
      .map((entry) => `${entry.name};dur=${entry.durationMs.toFixed(1)}`)
      .join(", ");
  }
}

export function applyServerTimingHeader<T extends Response>(response: T, timing: ServerTiming): T {
  const headerValue = timing.toHeaderValue();
  if (!headerValue) {
    return response;
  }

  response.headers.set("Server-Timing", headerValue);
  return response;
}
