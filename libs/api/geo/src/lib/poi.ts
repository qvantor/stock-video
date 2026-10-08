import { z } from 'zod';
import type { PoiCandidate } from '@dfs/contracts';
import { bearingDeg, gridKey, haversineM, inCameraSector, type CameraPose } from './math.js';
import { RateLimiter } from './rate-limit.js';
import type { FetchFn, GeoCache } from './types.js';

/** A named object near the drone, before distance/sector are computed. */
export interface RawPoi {
  name: string;
  nameEn: string;
  type: string;
  lat: number;
  lon: number;
  wikidataId: string | null;
}

const WikiSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z
          .object({
            title: z.string(),
            description: z.string().optional(),
            coordinates: z
              .array(
                z.object({ lat: z.number(), lon: z.number(), type: z.string().optional() }).loose(),
              )
              .optional(),
            pageprops: z.object({ wikibase_item: z.string().optional() }).loose().optional(),
          })
          .loose(),
      ),
    })
    .optional(),
});

const OverpassSchema = z.object({
  elements: z.array(
    z
      .object({
        lat: z.number().optional(),
        lon: z.number().optional(),
        center: z.object({ lat: z.number(), lon: z.number() }).optional(),
        tags: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
  ),
});

/** Wikipedia coordinate types that are areas, not things a camera looks at. */
const SKIP_TYPES = new Set(['country', 'state', 'adm1st', 'adm2nd', 'adm3rd', 'city']);
const OVERPASS_KEYS = ['tourism', 'historic', 'natural', 'man_made'] as const;
const OVERPASS_SKIP = new Set([
  'natural=tree',
  'natural=tree_row',
  'man_made=survey_point',
  'man_made=pipeline',
  'man_made=mast',
  'man_made=antenna',
  'man_made=manhole',
  'man_made=street_cabinet',
  'tourism=information',
  'tourism=hotel',
  'tourism=guest_house',
  'tourism=apartment',
  'tourism=hostel',
  'tourism=motel',
]);

export interface PoiOptions {
  cache: GeoCache;
  fetch?: FetchFn;
  wikipediaUrl?: string;
  overpassUrl?: string;
  limiter?: RateLimiter;
}

/** Landmarks near a point from Wikipedia geosearch (+ optionally OpenStreetMap Overpass). */
export class PoiClient {
  private readonly fetch: FetchFn;
  private readonly limiter: RateLimiter;

  constructor(private readonly opts: PoiOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.limiter = opts.limiter ?? new RateLimiter(2, 1000);
  }

  async wikipedia(lat: number, lon: number, radiusM: number, userAgent: string): Promise<RawPoi[]> {
    const grid = gridKey(lat, lon);
    const radius = Math.min(10_000, Math.max(10, Math.round(radiusM)));
    const key = `wiki:geosearch:${grid.key}:${radius}`;
    const cached = this.opts.cache.get(key) as RawPoi[] | undefined;
    if (cached) return cached;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'geosearch',
      ggscoord: `${grid.lat}|${grid.lon}`,
      ggsradius: String(radius),
      ggslimit: '40',
      prop: 'coordinates|pageprops|description',
      ppprop: 'wikibase_item',
      coprop: 'type',
      colimit: 'max',
    });
    const base = (this.opts.wikipediaUrl ?? 'https://en.wikipedia.org/w/api.php').replace(
      /\?$/,
      '',
    );
    const json = await this.get(`${base}?${params}`, userAgent);
    const pages = WikiSchema.parse(json).query?.pages ?? [];
    const pois: RawPoi[] = pages.flatMap((p) => {
      const c = p.coordinates?.[0];
      if (!c) return [];
      const type = c.type ?? p.description ?? 'landmark';
      if (SKIP_TYPES.has(type)) return [];
      return [
        {
          name: p.title,
          nameEn: p.title,
          type,
          lat: c.lat,
          lon: c.lon,
          wikidataId: p.pageprops?.wikibase_item ?? null,
        },
      ];
    });
    this.opts.cache.set(key, pois);
    return pois;
  }

  async overpass(lat: number, lon: number, radiusM: number, userAgent: string): Promise<RawPoi[]> {
    const grid = gridKey(lat, lon);
    const radius = Math.min(10_000, Math.round(radiusM));
    const key = `overpass:${grid.key}:${radius}`;
    const cached = this.opts.cache.get(key) as RawPoi[] | undefined;
    if (cached) return cached;
    const filters = OVERPASS_KEYS.map(
      (k) => `nwr(around:${radius},${grid.lat},${grid.lon})["name"]["${k}"];`,
    ).join('');
    const query = `[out:json][timeout:25];(${filters});out center tags 80;`;
    const url = this.opts.overpassUrl ?? 'https://overpass-api.de/api/interpreter';
    const json = await this.limiter.run(async () => {
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'user-agent': userAgent, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) throw new Error(`Overpass responded with HTTP ${res.status}`);
      return res.json();
    });
    const pois: RawPoi[] = OverpassSchema.parse(json).elements.flatMap((e) => {
      const tags = e.tags ?? {};
      const pos =
        e.center ??
        (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
      const k = OVERPASS_KEYS.find((key) => tags[key]);
      if (!pos || !tags['name'] || !k) return [];
      const type = `${k}=${tags[k]}`;
      if (OVERPASS_SKIP.has(type)) return [];
      return [
        {
          name: tags['name'],
          nameEn: tags['name:en'] ?? tags['int_name'] ?? tags['name'],
          type,
          lat: pos.lat,
          lon: pos.lon,
          wikidataId: tags['wikidata'] ?? null,
        },
      ];
    });
    this.opts.cache.set(key, pois);
    return pois;
  }

  private get(url: string, userAgent: string): Promise<unknown> {
    return this.limiter.run(async () => {
      const res = await this.fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Wikipedia responded with HTTP ${res.status}`);
      return res.json();
    });
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Merge, measure and rank candidates: objects in the camera's sector first (when the heading is
 * known), then by distance. Duplicates (same Wikidata id or name) are merged.
 */
export const rankPois = (
  from: { lat: number; lon: number },
  raw: RawPoi[],
  opts: { pose?: CameraPose | null; radiusM: number; limit?: number },
): PoiCandidate[] => {
  const byKey = new Map<string, PoiCandidate>();
  for (const p of raw) {
    const distanceM = Math.round(haversineM(from.lat, from.lon, p.lat, p.lon));
    if (distanceM > opts.radiusM) continue;
    const bearing = Math.round(bearingDeg(from.lat, from.lon, p.lat, p.lon) * 10) / 10;
    const candidate: PoiCandidate = {
      name: p.name,
      nameEn: p.nameEn,
      type: p.type,
      distanceM,
      bearingDeg: bearing,
      inCameraSector: opts.pose
        ? inCameraSector(opts.pose, { bearingDeg: bearing, distanceM })
        : null,
      wikidataId: p.wikidataId,
    };
    const keys = [p.wikidataId, norm(p.nameEn), norm(p.name)].filter(Boolean) as string[];
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (existing) {
      // Prefer the entry with a Wikidata id / English name; keep the shorter distance.
      existing.wikidataId ??= candidate.wikidataId;
      if (existing.nameEn === existing.name && candidate.nameEn !== candidate.name)
        existing.nameEn = candidate.nameEn;
      existing.distanceM = Math.min(existing.distanceM, candidate.distanceM);
      for (const k of keys) byKey.set(k, existing);
    } else {
      for (const k of keys) byKey.set(k, candidate);
    }
  }
  const unique = [...new Set(byKey.values())];
  unique.sort((a, b) => {
    const sa = a.inCameraSector === true ? 0 : 1;
    const sb = b.inCameraSector === true ? 0 : 1;
    return sa - sb || a.distanceM - b.distanceM;
  });
  return unique.slice(0, opts.limit ?? 12);
};
