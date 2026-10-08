import { eq } from 'drizzle-orm';
import type { GeoCache } from '@dfs/geo';
import type { Db } from '../db/client.js';
import { geoCache } from '../db/schema.js';

/** SQLite-backed cache for Nominatim / Wikipedia / Overpass responses. */
export class SqliteGeoCache implements GeoCache {
  constructor(private readonly db: Db) {}

  get(key: string): unknown {
    return this.db.select().from(geoCache).where(eq(geoCache.key, key)).get()?.value;
  }

  set(key: string, value: unknown): void {
    const fetchedAt = new Date().toISOString();
    this.db
      .insert(geoCache)
      .values({ key, value, fetchedAt })
      .onConflictDoUpdate({ target: geoCache.key, set: { value, fetchedAt } })
      .run();
  }
}
