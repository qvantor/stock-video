import { spawn } from 'node:child_process';
import { z } from 'zod';

const FfprobeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string().optional(),
      codec_name: z.string().optional(),
      profile: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      pix_fmt: z.string().optional(),
      bits_per_raw_sample: z.string().optional(),
      color_transfer: z.string().optional(),
      color_primaries: z.string().optional(),
      avg_frame_rate: z.string().optional(),
      r_frame_rate: z.string().optional(),
      nb_frames: z.string().optional(),
      duration: z.string().optional(),
      codec_tag_string: z.string().optional(),
      index: z.number().optional(),
      tags: z.record(z.string(), z.string()).optional(),
      side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
    }),
  ),
  format: z.object({
    duration: z.string().optional(),
    size: z.string().optional(),
    tags: z.record(z.string(), z.string()).optional(),
  }),
});

export type ColorTransfer = 'rec709' | 'hlg' | 'pq' | 'log' | 'unknown';

export interface GpsPoint {
  lat: number;
  lon: number;
  altitudeM: number | null;
}

/** Everything stage 2 needs to know about a source file, read from container/stream metadata. */
export interface MediaInfo {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  pixFmt: string | null;
  bitDepth: number;
  colorTransfer: ColorTransfer;
  hasAudio: boolean;
  /** Recording time as written by the camera (ISO string, may be local wall-clock time on DJI). */
  creationTime: string | null;
  /** GPS position from the ISO 6709 location tag, if the camera wrote one. */
  location: GpsPoint | null;
  make: string | null;
  model: string | null;
  /** All format + video stream tags, lower-cased keys. */
  tags: Record<string, string>;
  /** Index of a DJI "djmd" telemetry stream (per-frame GPS), if present. */
  djiMetaStream: number | null;
}

const parseRate = (rate: string | undefined): number | null => {
  if (!rate) return null;
  const [n, d] = rate.split('/').map(Number);
  if (!n || !d) return null;
  const v = n / d;
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
};

/** Parse an ISO 6709 string such as `+59.9386+030.3141+012.000/`. */
export const parseIso6709 = (value: string | undefined): GpsPoint | null => {
  if (!value) return null;
  const m =
    /^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?(?:CRS[^/]*)?\/?\s*$/.exec(
      value,
    );
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon, altitudeM: m[3] !== undefined ? Number(m[3]) : null };
};

const bitDepthOf = (pixFmt: string | undefined, raw: string | undefined): number => {
  const fromRaw = Number(raw);
  if (Number.isFinite(fromRaw) && fromRaw >= 8) return fromRaw;
  const m = /p(\d{2})(?:le|be)?$/.exec(pixFmt ?? '');
  return m ? Number(m[1]) : 8;
};

const LOG_TAG = /\b(d-?log|dlog|log-?m|s-?log|v-?log|c-?log|f-?log|n-?log)\b/i;

const transferOf = (transfer: string | undefined, tags: Record<string, string>): ColorTransfer => {
  if (Object.values(tags).some((v) => LOG_TAG.test(v))) return 'log';
  switch (transfer) {
    case 'arib-std-b67':
      return 'hlg';
    case 'smpte2084':
      return 'pq';
    case 'bt709':
    case 'smpte170m':
    case 'bt470bg':
    case 'iec61966-2-1':
      return 'rec709';
    default:
      return 'unknown';
  }
};

const pick = (tags: Record<string, string>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = tags[k]?.trim();
    if (v) return v;
  }
  return null;
};

const lowerKeys = (tags: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

/** Interpret raw ffprobe JSON (exported for tests). */
export const parseProbeOutput = (json: unknown): MediaInfo => {
  const data = FfprobeSchema.parse(json);
  const v = data.streams.find((s) => s.codec_type === 'video');
  if (!v || !v.width || !v.height) throw new Error('no video stream found');
  const fps = parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate);
  if (!fps) throw new Error('could not determine the frame rate');
  const durationSec = Number(data.format.duration ?? v.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('could not determine the duration');
  }
  const rotation =
    v.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ??
    Number(v.tags?.['rotate'] ?? 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  const tags = { ...lowerKeys(v.tags), ...lowerKeys(data.format.tags) };

  const encoder = pick(tags, 'encoder');
  const make =
    pick(tags, 'com.apple.quicktime.make', 'make') ??
    (encoder && /dji/i.test(encoder) ? 'DJI' : null);
  const model =
    pick(tags, 'com.apple.quicktime.model', 'model') ??
    (encoder && /dji/i.test(encoder) && !/^dji\.?(avc|hevc|h26[45])$/i.test(encoder)
      ? encoder
      : null);

  return {
    durationSec,
    fps,
    width: rotated ? v.height : v.width,
    height: rotated ? v.width : v.height,
    codec: v.codec_name ?? 'unknown',
    pixFmt: v.pix_fmt ?? null,
    bitDepth: bitDepthOf(v.pix_fmt, v.bits_per_raw_sample),
    colorTransfer: transferOf(v.color_transfer, tags),
    hasAudio: data.streams.some((s) => s.codec_type === 'audio'),
    creationTime: pick(tags, 'com.apple.quicktime.creationdate', 'creation_time', 'date'),
    location: parseIso6709(
      pick(tags, 'com.apple.quicktime.location.iso6709', 'location', 'location-eng') ?? undefined,
    ),
    make,
    model,
    tags,
    djiMetaStream:
      data.streams.find((s) => s.codec_type === 'data' && s.codec_tag_string === 'djmd')?.index ??
      null,
  };
};

/** Full ffprobe of a file: geometry, colour, audio, tags (GPS, creation time, camera). */
export const probeDetailed = (bin: string, file: string): Promise<MediaInfo> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe: ${err.trim() || `code ${code}`}`));
      try {
        resolve(parseProbeOutput(JSON.parse(out)));
      } catch (e) {
        reject(new Error(`ffprobe: ${(e as Error).message}`));
      }
    });
  });
