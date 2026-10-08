import { createHash } from 'node:crypto';

/** Canonical JSON (sorted keys) so equal inputs always hash equally. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );

export const hashOf = (...parts: unknown[]): string =>
  createHash('sha256').update(canonical(parts)).digest('hex').slice(0, 32);
