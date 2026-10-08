import type { GeoContext } from '@dfs/contracts';
import type { CameraPose } from './math.js';
import { NominatimClient } from './nominatim.js';
import { PoiClient, rankPois, type RawPoi } from './poi.js';
import { RateLimiter } from './rate-limit.js';
import type { FetchFn, GeoCache } from './types.js';

export interface GeoServiceOptions {
  cache: GeoCache;
  fetch?: FetchFn;
  nominatimUrl?: string;
  wikipediaUrl?: string;
  overpassUrl?: string;
  log?: { warn(obj: object, msg?: string): void };
}

export interface ResolveInput {
  lat: number;
  lon: number;
  altitudeM: number | null;
  source: GeoContext['source'];
  manualText: string | null;
  radiusM: number;
  userAgent: string;
  useOverpass: boolean;
  pose?: CameraPose | null;
}

/** Location context for a clip: reverse geocoding (English + local name) and nearby landmarks. */
export class GeoService {
  readonly nominatim: NominatimClient;
  readonly pois: PoiClient;

  constructor(private readonly opts: GeoServiceOptions) {
    this.nominatim = new NominatimClient({
      cache: opts.cache,
      fetch: opts.fetch,
      baseUrl: opts.nominatimUrl,
      limiter: new RateLimiter(1, 1000),
    });
    this.pois = new PoiClient({
      cache: opts.cache,
      fetch: opts.fetch,
      wikipediaUrl: opts.wikipediaUrl,
      overpassUrl: opts.overpassUrl,
    });
  }

  search(text: string, userAgent: string) {
    return this.nominatim.search(text, userAgent);
  }

  async resolve(input: ResolveInput): Promise<GeoContext> {
    const place = await this.nominatim.reverse(input.lat, input.lon, input.userAgent);
    const raw: RawPoi[] = [];
    try {
      raw.push(
        ...(await this.pois.wikipedia(input.lat, input.lon, input.radiusM, input.userAgent)),
      );
    } catch (err) {
      this.opts.log?.warn({ err: (err as Error).message }, 'Wikipedia geosearch failed');
    }
    if (input.useOverpass) {
      try {
        raw.push(
          ...(await this.pois.overpass(input.lat, input.lon, input.radiusM, input.userAgent)),
        );
      } catch (err) {
        this.opts.log?.warn({ err: (err as Error).message }, 'Overpass query failed');
      }
    }
    return {
      source: input.source,
      lat: input.lat,
      lon: input.lon,
      altitudeM: input.altitudeM,
      ...place,
      manualText: input.manualText,
      cameraHeadingDeg: input.pose?.yawDeg ?? null,
      poiCandidates: rankPois(input, raw, { pose: input.pose, radiusM: input.radiusM }),
    };
  }
}

/** Parse "lat, lon" typed into the manual location field. */
export const parseCoordinates = (text: string): { lat: number; lon: number } | null => {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};
