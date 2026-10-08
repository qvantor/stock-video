import type { GeoContext, TechContext } from '@dfs/contracts';
import { MOTION_PHRASES } from '@dfs/tech-analysis';

const SHOT_TYPE: Record<TechContext['shotType'], string> = {
  real_time: 'real time',
  slow_motion: 'slow motion',
  high_frame_rate: 'real time (high frame rate source)',
  timelapse: 'timelapse',
  hyperlapse: 'hyperlapse',
};

const TIME_OF_DAY: Record<NonNullable<TechContext['timeOfDay']>, string> = {
  sunrise: 'sunrise',
  golden_hour: 'golden hour',
  day: 'daytime',
  sunset: 'sunset',
  blue_hour: 'blue hour (twilight)',
  night: 'night',
};

const SOURCE: Record<GeoContext['source'], string> = {
  embedded: 'GPS from the video file',
  manual: 'location entered by the user',
  none: 'none',
};

const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');

/** Human-readable, factual context block for the prompt. */
export const describeContext = (geo: GeoContext | null, tech: TechContext): string => {
  const lines: string[] = [];
  const place = geo ? join([geo.city, geo.region, geo.country]) : '';
  if (geo && place) {
    lines.push(`Location: ${place} (source: ${SOURCE[geo.source]}).`);
    if (geo.localName) lines.push(`Local name: ${geo.localName}.`);
    if (geo.displayName) lines.push(`Full address: ${geo.displayName}.`);
    if (geo.lat !== null && geo.lon !== null) {
      lines.push(`Coordinates: ${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}.`);
    }
    if (geo.cameraHeadingDeg !== null && geo.cameraHeadingDeg !== undefined) {
      lines.push(
        `Estimated camera heading (from the flight direction): ${Math.round(geo.cameraHeadingDeg)}°.`,
      );
    }
    if (geo.poiCandidates.length) {
      lines.push(
        'Nearby landmark candidates (closest first; "in view" = inside the camera field of view):',
      );
      for (const p of geo.poiCandidates) {
        const view = p.inCameraSector === null ? 'unknown' : p.inCameraSector ? 'yes' : 'no';
        const local = p.name !== p.nameEn ? ` / ${p.name}` : '';
        lines.push(
          `- ${p.nameEn}${local} (${p.type}), ${p.distanceM} m away, bearing ${Math.round(p.bearingDeg)}°, in view: ${view}`,
        );
      }
    } else {
      lines.push('Nearby landmark candidates: none found.');
    }
  } else if (geo?.manualText) {
    lines.push(
      `Location (typed by the user, could not be verified): ${geo.manualText}. Use it only at region/country level and set placeConfidence to "low".`,
    );
  } else {
    lines.push(
      'Location: UNKNOWN. Do not guess or name any place, city or country; use generic terms and set placeConfidence to "unknown".',
    );
  }
  const altitude = tech.altitudeM ?? geo?.altitudeM ?? null;
  if (altitude !== null) lines.push(`GPS altitude: ${Math.round(altitude)} m above sea level.`);
  lines.push(`Camera movement: ${MOTION_PHRASES[tech.motionType]} (${tech.movement.join(', ')}).`);
  lines.push(`Shot type: ${SHOT_TYPE[tech.shotType]}.`);
  if (tech.timeOfDay) lines.push(`Time of day: ${TIME_OF_DAY[tech.timeOfDay]}.`);
  if (tech.season) lines.push(`Season: ${tech.season}.`);
  if (tech.captureDate) lines.push(`Capture date: ${tech.captureDate}.`);
  lines.push(`Clip duration: ${Math.round(tech.durationSec)} s.`);
  return lines.join('\n');
};

/** Extra instructions from the user (regenerate with a hint / chosen landmark). */
export const describeHint = (hint: string | null, poiName: string | null): string => {
  const lines: string[] = [];
  if (poiName) {
    lines.push(
      `The user confirmed that the main subject is: ${poiName}. Name it in the title and keywords and set placeConfidence to "high".`,
    );
  }
  if (hint) lines.push(`User hint (treat as reliable): ${hint}`);
  return lines.length ? `\n${lines.join('\n')}\n` : '';
};
