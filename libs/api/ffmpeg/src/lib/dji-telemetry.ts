import { spawn } from 'node:child_process';
import { decodeProtobuf, type PbField } from './protobuf.js';

/** One GPS sample from the drone's embedded telemetry. */
export interface TelemetryPoint {
  /** Seconds from the start of the video. */
  t: number;
  lat: number;
  lon: number;
  /** GPS altitude above sea level, metres (if present). */
  altitudeM: number | null;
}

/**
 * Field paths inside DJI "djmd" (DJI meta) protobuf packets, per schema name found in the first
 * packet (`1.1.1`, e.g. "dvtm_Mini4_Pro.proto"). Verified on DJI Mini 4 Pro footage: latitude and
 * longitude are doubles in radians, altitude is an integer in millimetres. Unknown schemas fall back
 * to the same paths and are accepted only if the values pass the sanity checks below.
 */
export const DJI_GPS_PATHS: Record<string, { lat: string; lon: string; altMm: string }> = {
  'dvtm_Mini4_Pro.proto': { lat: '3.3.4.1.2', lon: '3.3.4.1.3', altMm: '3.3.4.2' },
};
const DEFAULT_PATHS = { lat: '3.3.4.1.2', lon: '3.3.4.1.3', altMm: '3.3.4.2' };

const RAD = 180 / Math.PI;

const pick = (fields: PbField[], path: string) => fields.find((f) => f.path === path);

const toSigned = (v: bigint) => (v > 0x7fffffffffffffffn ? v - 0x10000000000000000n : v);

/** Decode djmd packets (with their timestamps) into GPS points; null if no usable fix. */
export const parseDjiMeta = (
  packets: { t: number; data: Uint8Array }[],
  opts: { sampleEverySec?: number } = {},
): { schema: string | null; points: TelemetryPoint[] } => {
  let schema: string | null = null;
  const points: TelemetryPoint[] = [];
  const step = opts.sampleEverySec ?? 0.5;
  let lastT = -Infinity;
  for (const p of packets) {
    const fields = decodeProtobuf(p.data);
    if (!fields) continue;
    if (schema === null) {
      const name = pick(fields, '1.1.1');
      if (name?.type === 'bytes') schema = new TextDecoder().decode(name.value as Uint8Array);
    }
    if (p.t - lastT < step) continue;
    const paths = (schema && DJI_GPS_PATHS[schema]) || DEFAULT_PATHS;
    const lat = pick(fields, paths.lat);
    const lon = pick(fields, paths.lon);
    if (lat?.type !== 'f64' || lon?.type !== 'f64') continue;
    const latDeg = (lat.value as number) * RAD;
    const lonDeg = (lon.value as number) * RAD;
    // No fix: zeros or out-of-range values.
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
    if (
      Math.abs(latDeg) > 90 ||
      Math.abs(lonDeg) > 180 ||
      (Math.abs(latDeg) < 1e-6 && Math.abs(lonDeg) < 1e-6)
    )
      continue;
    const alt = pick(fields, paths.altMm);
    const altitudeM = alt?.type === 'varint' ? Number(toSigned(alt.value as bigint)) / 1000 : null;
    points.push({
      t: Math.round(p.t * 1000) / 1000,
      lat: Math.round(latDeg * 1e7) / 1e7,
      lon: Math.round(lonDeg * 1e7) / 1e7,
      altitudeM:
        altitudeM !== null && Math.abs(altitudeM) < 10_000 ? Math.round(altitudeM * 10) / 10 : null,
    });
    lastT = p.t;
  }
  return { schema, points: consistent(points) };
};

/** Drop isolated jumps (> 2 km between consecutive samples) that indicate a decoding mismatch. */
const consistent = (points: TelemetryPoint[]): TelemetryPoint[] => {
  if (points.length < 3) return points;
  const ok = points.filter((p, i) => {
    const prev = points[i - 1] ?? points[i + 1];
    if (!prev) return true;
    const dLat = (p.lat - prev.lat) * 111_000;
    const dLon = (p.lon - prev.lon) * 111_000 * Math.cos((p.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLon) < 2000;
  });
  return ok.length >= points.length / 2 ? ok : [];
};

const run = (bin: string, args: string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`${bin} exited with ${code}: ${err.trim()}`)),
    );
  });

/**
 * Read the GPS track from a DJI "djmd" data stream (DJI Mini 4 Pro and similar).
 * Returns null when the file has no such stream or no GPS fix.
 */
export const readDjiTelemetry = async (
  bins: { ffmpegPath: string; ffprobePath: string },
  file: string,
  streamIndex: number,
): Promise<{ schema: string | null; points: TelemetryPoint[] } | null> => {
  // prettier-ignore
  const listing = await run(bins.ffprobePath, [
    '-v', 'error', '-select_streams', String(streamIndex),
    '-show_entries', 'packet=pts_time,size', '-of', 'csv=p=0', file,
  ]);
  const sizes = listing
    .toString()
    .trim()
    .split('\n')
    .map((line) => {
      const [t, size] = line.split(',');
      return { t: Number(t), size: Number(size) };
    })
    .filter((p) => Number.isFinite(p.t) && p.size > 0);
  if (!sizes.length) return null;
  // prettier-ignore
  const data = await run(bins.ffmpegPath, [
    '-v', 'error', '-i', file, '-map', `0:${streamIndex}`, '-c', 'copy', '-f', 'data', 'pipe:1',
  ]);
  const packets: { t: number; data: Uint8Array }[] = [];
  let offset = 0;
  for (const s of sizes) {
    if (offset + s.size > data.length) break;
    packets.push({ t: s.t, data: data.subarray(offset, offset + s.size) });
    offset += s.size;
  }
  const result = parseDjiMeta(packets);
  return result.points.length ? result : null;
};
