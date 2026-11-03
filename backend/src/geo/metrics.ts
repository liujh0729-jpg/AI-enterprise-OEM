const platforms = new Map<
  string,
  {
    calls: number;
    failures: number;
    elapsedMs: number;
    samples: number[];
    lastCalledAt: string;
  }
>();
export function recordModelCall(
  platform: string,
  elapsedMs: number,
  failed: boolean,
) {
  const key = platform || 'unknown';
  const row = platforms.get(key) ?? {
    calls: 0,
    failures: 0,
    elapsedMs: 0,
    samples: [],
    lastCalledAt: '',
  };
  row.calls++;
  row.failures += failed ? 1 : 0;
  row.elapsedMs += elapsedMs;
  row.samples.push(elapsedMs);
  if (row.samples.length > 1000) row.samples.shift();
  row.lastCalledAt = new Date().toISOString();
  platforms.set(key, row);
}
export function modelMetrics() {
  return Object.fromEntries(
    [...platforms].map(([key, row]) => {
      const samples = [...row.samples].sort((a, b) => a - b);
      return [
        key,
        {
          calls: row.calls,
          failures: row.failures,
          failureRate: row.failures / row.calls,
          averageMs: Math.round(row.elapsedMs / row.calls),
          p95Ms: Math.round(samples[Math.ceil(samples.length * 0.95) - 1] ?? 0),
          lastCalledAt: row.lastCalledAt,
        },
      ];
    }),
  );
}
