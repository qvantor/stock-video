import path from 'node:path';
import { GeoService, type FetchFn } from '@dfs/geo';
import { openDatabase } from '../db/client.js';
import { SqliteGeoCache } from './geo-cache.js';

describe('SqliteGeoCache', () => {
  it('persists geocoding responses so repeated lookups do not hit Nominatim', async () => {
    const { db, close } = openDatabase(
      ':memory:',
      path.resolve(import.meta.dirname, '../../drizzle'),
    );
    let calls = 0;
    const fetchMock: FetchFn = async () => {
      calls++;
      return new Response(
        JSON.stringify([{ lat: '48.8584', lon: '2.2945', display_name: 'Eiffel Tower' }]),
      );
    };
    const first = new GeoService({ cache: new SqliteGeoCache(db), fetch: fetchMock });
    await first.search('Eiffel Tower', 'test/1.0');
    // A new service (e.g. after a restart) reads from the same table.
    const second = new GeoService({ cache: new SqliteGeoCache(db), fetch: fetchMock });
    expect(await second.search('eiffel tower', 'test/1.0')).toEqual({
      lat: 48.8584,
      lon: 2.2945,
      displayName: 'Eiffel Tower',
    });
    expect(calls).toBe(1);
    close();
  });
});
