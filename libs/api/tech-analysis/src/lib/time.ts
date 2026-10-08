import tzLookup from '@photostructure/tz-lookup';
import { getPosition, getTimes } from 'suncalc';
import type { CreationTimeMode, Season, TimeOfDay } from './types.js';

/** IANA time zone for coordinates (null if lookup fails). */
export const timeZoneAt = (lat: number, lon: number): string | null => {
  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
};

/** Offset of a time zone from UTC at an instant, in minutes. */
export const tzOffsetMinutes = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export interface CaptureTime {
  /** UTC instant, or null when it cannot be determined. */
  utc: Date | null;
  /** Local calendar date at the location (yyyy-mm-dd). */
  localDate: string | null;
  /** Local month 1..12 (for the season). */
  localMonth: number | null;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;
/** Camera/app file names carry local time: DJI_20240714213000_0001_D.MP4, dji_fly_20260811_133558_… */
const FILENAME_TIME = /(?:^|\D)(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?!\d)/;

/** Local wall-clock time encoded in a file name, as UTC-based milliseconds (no zone applied). */
export const filenameWallClock = (filename: string | null | undefined): number | null => {
  const m = FILENAME_TIME.exec(filename ?? '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
};

/** Convert local wall-clock milliseconds in a zone to a UTC instant (DST-safe). */
const wallToUtc = (wall: number, zone: string): Date => {
  const first = new Date(wall - tzOffsetMinutes(new Date(wall), zone) * 60000);
  return new Date(wall - tzOffsetMinutes(first, zone) * 60000);
};

/**
 * Capture time of a recording. In `auto` mode:
 * 1. a timestamp in the file name (local camera/phone time) is converted with the time zone at the
 *    GPS position;
 * 2. otherwise DJI `creation_time` is treated as local wall-clock time labelled as UTC (older DJI
 *    aircraft do this);
 * 3. otherwise `creation_time` is real UTC.
 */
export const resolveCaptureTime = (input: {
  creationTime: string | null;
  mode: CreationTimeMode;
  make: string | null;
  lat: number | null;
  lon: number | null;
  filename?: string | null;
}): CaptureTime => {
  const none: CaptureTime = { utc: null, localDate: null, localMonth: null };
  const zoneOf = () =>
    input.lat !== null && input.lon !== null ? timeZoneAt(input.lat, input.lon) : null;
  if (input.mode === 'auto') {
    const wall = filenameWallClock(input.filename);
    if (wall !== null) {
      const zone = zoneOf();
      const fromTag =
        input.creationTime && /Z$|[+-]\d{2}:?\d{2}$/.test(input.creationTime)
          ? new Date(input.creationTime)
          : null;
      const utc = zone
        ? wallToUtc(wall, zone)
        : fromTag && !Number.isNaN(fromTag.getTime())
          ? fromTag
          : null;
      const local = new Date(wall);
      return { utc, localDate: ymd(local), localMonth: local.getUTCMonth() + 1 };
    }
  }
  if (!input.creationTime) return none;
  const m = WALL_CLOCK.exec(input.creationTime);
  if (!m) return none;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (y < 2000) return none; // cameras with an unset clock write 1904/1970
  const zone = zoneOf();
  const local = input.mode === 'local' || (input.mode === 'auto' && /dji/i.test(input.make ?? ''));

  if (local) {
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    // Two passes handle DST transitions near the instant.
    const utc = zone ? wallToUtc(wall, zone) : null;
    return { utc, localDate: ymd(new Date(wall)), localMonth: mo };
  }

  const utc = new Date(input.creationTime);
  if (Number.isNaN(utc.getTime())) return none;
  const shifted = zone ? new Date(utc.getTime() + tzOffsetMinutes(utc, zone) * 60000) : utc;
  return { utc, localDate: ymd(shifted), localMonth: shifted.getUTCMonth() + 1 };
};

/**
 * Light condition from the sun's altitude at the location:
 * night < -6° ≤ blue hour < -0.833° ≤ sunrise/sunset < 2° ≤ golden hour < 6° ≤ day.
 */
export const timeOfDay = (instant: Date, lat: number, lon: number): TimeOfDay => {
  // suncalc v2 returns the apparent altitude in degrees.
  const altitude = getPosition(instant, lat, lon).altitude;
  if (altitude < -6) return 'night';
  if (altitude < -0.833) return 'blue_hour';
  const noon = getTimes(instant, lat, lon).solarNoon;
  const morning = instant.getTime() < noon.getTime();
  if (altitude < 2) return morning ? 'sunrise' : 'sunset';
  if (altitude < 6) return 'golden_hour';
  return 'day';
};

const NORTH: Season[] = [
  'winter',
  'winter',
  'spring',
  'spring',
  'spring',
  'summer',
  'summer',
  'summer',
  'autumn',
  'autumn',
  'autumn',
  'winter',
];
const OPPOSITE: Record<Season, Season> = {
  winter: 'summer',
  summer: 'winter',
  spring: 'autumn',
  autumn: 'spring',
};

/** Meteorological season for a local month, flipped for the southern hemisphere. */
export const seasonOf = (localMonth: number, lat: number): Season => {
  const north = NORTH[(localMonth - 1) % 12] as Season;
  return lat < 0 ? OPPOSITE[north] : north;
};
