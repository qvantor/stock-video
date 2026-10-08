/** Persistent key/value cache for geo responses (SQLite in the API, in memory in tests). */
export interface GeoCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class MemoryGeoCache implements GeoCache {
  readonly map = new Map<string, unknown>();
  get(key: string): unknown {
    return this.map.get(key);
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
}
