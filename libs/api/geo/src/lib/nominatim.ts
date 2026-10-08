import { z } from 'zod';
import { gridKey } from './math.js';
import { RateLimiter } from './rate-limit.js';
import type { FetchFn, GeoCache } from './types.js';

const AddressSchema = z
  .object({
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    hamlet: z.string().optional(),
    municipality: z.string().optional(),
    suburb: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    region: z.string().optional(),
    province: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional(),
  })
  .loose();

const ReverseSchema = z.union([
  z
    .object({
      display_name: z.string(),
      name: z.string().optional(),
      address: AddressSchema.optional(),
    })
    .loose(),
  z.object({ error: z.string() }),
]);

const SearchSchema = z.array(
  z.object({ lat: z.coerce.number(), lon: z.coerce.number(), display_name: z.string() }).loose(),
);

export interface PlaceInfo {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  displayName: string | null;
  /** Most specific name in the local language. */
  localName: string | null;
}

export interface SearchResult {
  lat: number;
  lon: number;
  displayName: string;
}

const EMPTY_PLACE: PlaceInfo = {
  city: null,
  region: null,
  country: null,
  countryCode: null,
  displayName: null,
  localName: null,
};

type Address = z.infer<typeof AddressSchema>;
const cityOf = (a: Address | undefined) =>
  a?.city ??
  a?.town ??
  a?.village ??
  a?.hamlet ??
  a?.municipality ??
  a?.suburb ??
  a?.county ??
  null;
const regionOf = (a: Address | undefined) =>
  a?.state ?? a?.region ?? a?.province ?? a?.county ?? null;

export interface NominatimOptions {
  cache: GeoCache;
  fetch?: FetchFn;
  baseUrl?: string;
  /** Shared limiter; Nominatim allows at most 1 request per second. */
  limiter?: RateLimiter;
}

/** OpenStreetMap Nominatim client with a coordinate-grid cache and 1 req/s rate limit. */
export class NominatimClient {
  private readonly fetch: FetchFn;
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;

  constructor(private readonly opts: NominatimOptions) {
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = (opts.baseUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    this.limiter = opts.limiter ?? new RateLimiter(1, 1000);
  }

  /** Reverse geocode in English plus the local-language name. */
  async reverse(lat: number, lon: number, userAgent: string): Promise<PlaceInfo> {
    const grid = gridKey(lat, lon);
    const en = await this.reverseRaw(grid, 'en', userAgent);
    if (!en || 'error' in en) return EMPTY_PLACE;
    const local = await this.reverseRaw(grid, null, userAgent);
    const localData = local && !('error' in local) ? local : null;
    return {
      city: cityOf(en.address),
      region: regionOf(en.address),
      country: en.address?.country ?? null,
      countryCode: en.address?.country_code?.toUpperCase() ?? null,
      displayName: en.display_name,
      localName: localData ? localData.name || cityOf(localData.address) || null : null,
    };
  }

  /** Forward geocode free text (manual location field). */
  async search(text: string, userAgent: string): Promise<SearchResult | null> {
    const q = text.trim().replace(/\s+/g, ' ');
    const key = `nominatim:search:${q.toLowerCase()}`;
    const cached = this.opts.cache.get(key) as { result: SearchResult | null } | undefined;
    if (cached) return cached.result;
    const url = `${this.baseUrl}/search?${new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: '1',
      'accept-language': 'en',
    })}`;
    const json = await this.request(url, userAgent);
    const [first] = SearchSchema.parse(json);
    const result = first
      ? { lat: first.lat, lon: first.lon, displayName: first.display_name }
      : null;
    this.opts.cache.set(key, { result });
    return result;
  }

  private async reverseRaw(
    grid: { lat: number; lon: number; key: string },
    lang: 'en' | null,
    userAgent: string,
  ): Promise<z.infer<typeof ReverseSchema> | null> {
    const key = `nominatim:reverse:${lang ?? 'local'}:${grid.key}`;
    const cached = this.opts.cache.get(key);
    if (cached !== undefined) return ReverseSchema.parse(cached);
    const params = new URLSearchParams({
      lat: String(grid.lat),
      lon: String(grid.lon),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '16',
    });
    if (lang) params.set('accept-language', lang);
    const json = await this.request(`${this.baseUrl}/reverse?${params}`, userAgent);
    const parsed = ReverseSchema.parse(json);
    this.opts.cache.set(key, parsed);
    return parsed;
  }

  private request(url: string, userAgent: string): Promise<unknown> {
    return this.limiter.run(async () => {
      const res = await this.fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Nominatim responded with HTTP ${res.status}`);
      return res.json();
    });
  }
}
