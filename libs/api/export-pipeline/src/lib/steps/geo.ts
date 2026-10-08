import type { GeoContext, MotionType } from '@dfs/contracts';
import type { TelemetryPoint } from '@dfs/ffmpeg';
import { bearingDeg, haversineM, parseCoordinates } from '@dfs/geo';
import { hashOf } from '../hash.js';
import type { PipelineStep, StepContext } from '../types.js';
import type { StepDeps } from './deps.js';

const unknownPlace = (source: GeoContext['source'], manualText: string | null): GeoContext => ({
  source,
  lat: null,
  lon: null,
  altitudeM: null,
  city: null,
  region: null,
  country: null,
  countryCode: null,
  displayName: null,
  localName: null,
  manualText,
  cameraHeadingDeg: null,
  poiCandidates: [],
});

/** Telemetry sample closest to a time. */
const pointAt = (track: TelemetryPoint[], t: number): TelemetryPoint | null =>
  track.reduce<TelemetryPoint | null>(
    (best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best),
    null,
  );

/** Minimum distance flown for the flight direction to mean anything. */
const MIN_TRACK_M = 15;

/**
 * Camera heading estimated from the flight direction: a drone flying forward looks where it
 * flies, flying backward it looks the other way. Other movements give no reliable heading.
 */
export const headingFromTrack = (
  start: TelemetryPoint | null,
  end: TelemetryPoint | null,
  motion: MotionType,
): number | null => {
  if (!start || !end || (motion !== 'forward' && motion !== 'backward')) return null;
  if (haversineM(start.lat, start.lon, end.lat, end.lon) < MIN_TRACK_M) return null;
  const bearing = bearingDeg(start.lat, start.lon, end.lat, end.lon);
  return Math.round((motion === 'forward' ? bearing : (bearing + 180) % 360) * 10) / 10;
};

/** Middle, start and end GPS points of the clip (from the file's telemetry or its location tag). */
const clipTrack = async (deps: StepDeps, { clip, video }: StepContext) => {
  const track = await deps.videos.getTelemetry(video.id);
  if (track?.length) {
    return {
      mid: pointAt(track, (clip.startSec + clip.endSec) / 2),
      start: pointAt(track, clip.startSec),
      end: pointAt(track, clip.endSec),
    };
  }
  const gps = video.media.location;
  return gps ? { mid: { t: 0, ...gps }, start: null, end: null } : null;
};

/**
 * Location context. Priority: manual location of the video (coordinates or geocoded text) →
 * GPS from the file (DJI telemetry track or container location tag) → unknown (the model is told so).
 */
export const geoStep = (deps: StepDeps): PipelineStep => ({
  name: 'geo',

  hash: async (ctx) =>
    hashOf(
      'geo.v2',
      ctx.video.manualLocation,
      ctx.video.manualLocation ? null : await clipTrack(deps, ctx),
      ctx.clip.motionType,
      ctx.settings.poiRadiusM,
      ctx.settings.useOverpass,
    ),

  isComplete: (clip) => clip.geo !== null,

  run: async (ctx) => {
    const { video, settings, log, clip } = ctx;
    const common = {
      radiusM: settings.poiRadiusM,
      userAgent: settings.nominatimUserAgent,
      useOverpass: settings.useOverpass,
    };
    const manual = video.manualLocation?.trim() || null;
    if (manual) {
      const coords =
        parseCoordinates(manual) ?? (await deps.geo.search(manual, settings.nominatimUserAgent));
      if (!coords) {
        log.warn({ videoId: video.id, manual }, 'manual location could not be geocoded');
        return { geo: unknownPlace('manual', manual) };
      }
      const geo = await deps.geo.resolve({
        ...coords,
        altitudeM: null,
        source: 'manual',
        manualText: manual,
        ...common,
      });
      return { geo: { ...geo, cameraHeadingDeg: null } };
    }
    const track = await clipTrack(deps, ctx);
    if (track?.mid) {
      const heading = headingFromTrack(track.start, track.end, clip.motionType);
      const geo = await deps.geo.resolve({
        lat: track.mid.lat,
        lon: track.mid.lon,
        altitudeM: track.mid.altitudeM,
        source: 'embedded',
        manualText: null,
        pose: heading !== null ? { yawDeg: heading } : null,
        ...common,
      });
      return { geo: { ...geo, cameraHeadingDeg: heading } };
    }
    return { geo: unknownPlace('none', null) };
  },
});
