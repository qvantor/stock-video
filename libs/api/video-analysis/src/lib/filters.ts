/** Odd window length (in samples) for a window given in seconds. */
export const windowSamples = (seconds: number, fps: number): number => {
  const n = Math.max(1, Math.round(seconds * fps));
  return n % 2 === 0 ? n + 1 : n;
};

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Centered running median with a shrinking window at the edges. */
export const medianFilter = (values: readonly number[], window: number): number[] => {
  const half = window >> 1;
  return values.map((_, i) => median(values.slice(Math.max(0, i - half), i + half + 1)));
};

/** Centered running mode (majority vote); ties keep the original value. */
export const modeFilter = <T>(values: readonly T[], window: number): T[] => {
  const half = window >> 1;
  return values.map((v, i) => {
    const counts = new Map<T, number>();
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      const x = values[j] as T;
      counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    let best = v;
    let bestCount = counts.get(v) ?? 0;
    for (const [k, c] of counts) {
      if (c > bestCount) {
        best = k;
        bestCount = c;
      }
    }
    return best;
  });
};

export const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export const stdDev = (values: readonly number[]): number => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
