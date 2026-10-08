import { GeoService, parseCoordinates } from './geo-service.js';
import { bearingDeg, gridKey, haversineM, inCameraSector } from './math.js';
import { rankPois, type RawPoi } from './poi.js';
import { RateLimiter } from './rate-limit.js';
import { MemoryGeoCache, type FetchFn } from './types.js';

const UA = 'dfs-test/1.0 (test@example.com)';

const reverseEn = {
  display_name: 'Palace Square, Saint Petersburg, Northwestern Federal District, Russia',
  name: 'Palace Square',
  address: {
    city: 'Saint Petersburg',
    state: 'Saint Petersburg',
    country: 'Russia',
    country_code: 'ru',
  },
};
const reverseLocal = {
  display_name: 'Дворцовая площадь, Санкт-Петербург, Россия',
  name: 'Дворцовая площадь',
  address: { city: 'Санкт-Петербург', country: 'Россия', country_code: 'ru' },
};
const wiki = {
  query: {
    pages: [
      {
        title: 'Alexander Column',
        coordinates: [{ lat: 59.93904, lon: 30.31583, type: 'landmark' }],
        pageprops: { wikibase_item: 'Q192826' },
      },
      {
        title: 'Saint Petersburg',
        coordinates: [{ lat: 59.95, lon: 30.3167, type: 'city' }],
        pageprops: { wikibase_item: 'Q656' },
      },
      {
        title: "Saint Isaac's Cathedral",
        coordinates: [{ lat: 59.93408, lon: 30.30611, type: 'landmark' }],
        pageprops: { wikibase_item: 'Q188839' },
      },
    ],
  },
};

const mockFetch = () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const body = url.includes('/reverse')
      ? url.includes('accept-language=en')
        ? reverseEn
        : reverseLocal
      : url.includes('/search')
        ? [{ lat: '55.7558', lon: '37.6173', display_name: 'Moscow, Russia' }]
        : wiki;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fn, calls };
};

describe('gridKey', () => {
  it('snaps points ~20 m apart to the same key and ~200 m apart to different keys', () => {
    const a = gridKey(59.939, 30.3158);
    const b = gridKey(a.lat + 0.0001, a.lon - 0.0002); // ~11 m north, ~11 m west of the cell centre
    const c = gridKey(a.lat + 0.0018, a.lon); // ~200 m north
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });
});

describe('math', () => {
  it('distance and bearing', () => {
    expect(haversineM(59.939, 30.3158, 59.939, 30.3158)).toBe(0);
    expect(Math.round(haversineM(0, 0, 0, 1) / 1000)).toBe(111);
    expect(Math.round(bearingDeg(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearingDeg(0, 0, 0, 1))).toBe(90);
    expect(Math.round(bearingDeg(0, 0, 0, -1))).toBe(270);
  });

  it('camera sector', () => {
    const pose = { yawDeg: 350 };
    expect(inCameraSector(pose, { bearingDeg: 20, distanceM: 500 })).toBe(true);
    expect(inCameraSector(pose, { bearingDeg: 90, distanceM: 500 })).toBe(false);
    // Looking down steeply from 100 m: a target 30 m away is below the frame.
    expect(
      inCameraSector({ yawDeg: 0, pitchDeg: -30, heightM: 100 }, { bearingDeg: 0, distanceM: 30 }),
    ).toBe(false);
    expect(
      inCameraSector({ yawDeg: 0, pitchDeg: -30, heightM: 100 }, { bearingDeg: 0, distanceM: 400 }),
    ).toBe(true);
    expect(
      inCameraSector(
        { yawDeg: 0, pitchDeg: -90, heightM: 100 },
        { bearingDeg: 180, distanceM: 50 },
      ),
    ).toBe(true);
  });
});

describe('rankPois', () => {
  const raw: RawPoi[] = [
    {
      name: 'Far behind',
      nameEn: 'Far behind',
      type: 'landmark',
      lat: 59.93,
      lon: 30.3158,
      wikidataId: null,
    },
    {
      name: 'Near ahead',
      nameEn: 'Near ahead',
      type: 'landmark',
      lat: 59.945,
      lon: 30.3158,
      wikidataId: 'Q1',
    },
    {
      name: 'Near ahead',
      nameEn: 'Near ahead',
      type: 'historic=monument',
      lat: 59.9451,
      lon: 30.3158,
      wikidataId: null,
    },
    {
      name: 'Out of range',
      nameEn: 'Out of range',
      type: 'landmark',
      lat: 60.5,
      lon: 30.3,
      wikidataId: null,
    },
  ];
  const from = { lat: 59.94, lon: 30.3158 };

  it('sorts by distance and merges duplicates without a heading', () => {
    const r = rankPois(from, raw, { radiusM: 2000 });
    expect(r.map((p) => p.name)).toEqual(['Near ahead', 'Far behind']);
    expect(r[0]).toMatchObject({ wikidataId: 'Q1', inCameraSector: null });
  });

  it('puts objects in the camera sector first when the heading is known', () => {
    const r = rankPois(from, raw, { radiusM: 2000, pose: { yawDeg: 180 } });
    expect(r.map((p) => [p.name, p.inCameraSector])).toEqual([
      ['Far behind', true],
      ['Near ahead', false],
    ]);
  });
});

describe('GeoService', () => {
  it('reverse geocodes in English, keeps the local name, filters area POIs and caches', async () => {
    const { fn, calls } = mockFetch();
    const cache = new MemoryGeoCache();
    const geo = new GeoService({ cache, fetch: fn });
    const input = {
      lat: 59.93906,
      lon: 30.31556,
      altitudeM: 80,
      source: 'embedded' as const,
      manualText: null,
      radiusM: 2000,
      userAgent: UA,
      useOverpass: false,
    };
    const ctx = await geo.resolve(input);
    expect(ctx).toMatchObject({
      city: 'Saint Petersburg',
      country: 'Russia',
      countryCode: 'RU',
      localName: 'Дворцовая площадь',
    });
    expect(ctx.poiCandidates.map((p) => p.nameEn)).toEqual([
      'Alexander Column',
      "Saint Isaac's Cathedral",
    ]);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.headers['user-agent'] === UA)).toBe(true);
    expect(calls[0]?.url).toContain('accept-language=en');

    // A nearby point (~10 m) is served entirely from the cache.
    await geo.resolve({ ...input, lat: 59.93913 });
    expect(calls).toHaveLength(3);
  });

  it('forward geocodes manual text and caches it', async () => {
    const { fn, calls } = mockFetch();
    const geo = new GeoService({ cache: new MemoryGeoCache(), fetch: fn });
    expect(await geo.search('Moscow,  Russia', UA)).toEqual({
      lat: 55.7558,
      lon: 37.6173,
      displayName: 'Moscow, Russia',
    });
    await geo.search('moscow, russia', UA);
    expect(calls).toHaveLength(1);
  });

  it('rejects malformed Nominatim responses', async () => {
    const bad: FetchFn = async () =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    const geo = new GeoService({ cache: new MemoryGeoCache(), fetch: bad });
    await expect(geo.nominatim.reverse(1, 1, UA)).rejects.toThrow();
  });
});

describe('RateLimiter', () => {
  it('spaces calls by the interval', async () => {
    const limiter = new RateLimiter(1, 100);
    const times: number[] = [];
    const start = Date.now();
    await Promise.all(
      [1, 2, 3].map(() => limiter.run(async () => void times.push(Date.now() - start))),
    );
    const [t0 = 0, t1 = 0, t2 = 0] = times;
    expect(t1 - t0).toBeGreaterThanOrEqual(90);
    expect(t2 - t1).toBeGreaterThanOrEqual(90);
  });
});

describe('parseCoordinates', () => {
  it('parses "lat, lon" and rejects place names', () => {
    expect(parseCoordinates('59.9386, 30.3141')).toEqual({ lat: 59.9386, lon: 30.3141 });
    expect(parseCoordinates('-33.85 151.21')).toEqual({ lat: -33.85, lon: 151.21 });
    expect(parseCoordinates('Kizhi, Russia')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
  });
});
