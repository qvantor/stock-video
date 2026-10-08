import type { MotionType, SlowMoConform, TechContext } from '@dfs/contracts';
import { mapMovement } from './movement.js';
import { resolutionLabel } from './resolution.js';
import { detectShotType, outputDuration, outputFps, type ShotTypeConfig } from './shot-type.js';
import { resolveCaptureTime, seasonOf, timeOfDay } from './time.js';
import type { CreationTimeMode } from './types.js';

/** Media facts the tech step needs (a subset of the ffprobe info). */
export interface TechMediaInput {
  fps: number;
  width: number;
  height: number;
  codec: string;
  bitDepth: number;
  colorTransfer: TechContext['colorTransfer'];
  hasAudio: boolean;
  creationTime: string | null;
  make: string | null;
  model: string | null;
  tags: Record<string, string>;
}

export interface TechInput {
  media: TechMediaInput;
  originalFilename: string;
  startSec: number;
  endSec: number;
  motionType: MotionType;
  /** Offset of the clip from the start of the recording (to shift the capture time). */
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  slowMoConform: SlowMoConform;
  creationTimeMode: CreationTimeMode;
  shotTypeConfig?: ShotTypeConfig;
}

/** All deterministic technical features of a clip (no LLM). */
export const analyzeTech = (input: TechInput): TechContext => {
  const { media } = input;
  const sourceDurationSec = input.endSec - input.startSec;
  const conformFps = input.slowMoConform === 'off' ? null : Number(input.slowMoConform);
  const shotType = detectShotType(
    {
      fps: media.fps,
      conformFps,
      durationSec: sourceDurationSec,
      originalFilename: input.originalFilename,
      tags: media.tags,
      motionType: input.motionType,
    },
    input.shotTypeConfig,
  );

  const capture = resolveCaptureTime({
    creationTime: media.creationTime,
    mode: input.creationTimeMode,
    make: media.make,
    lat: input.lat,
    lon: input.lon,
    filename: input.originalFilename,
  });
  // The container time is the start of the recording; the clip starts later.
  const clipInstant = capture.utc ? new Date(capture.utc.getTime() + input.startSec * 1000) : null;
  const hasPosition = input.lat !== null && input.lon !== null;

  return {
    durationSec: outputDuration(sourceDurationSec, media.fps, shotType, conformFps),
    sourceDurationSec,
    fps: media.fps,
    outputFps: outputFps(media.fps, shotType, conformFps),
    width: media.width,
    height: media.height,
    resolutionLabel: resolutionLabel(media.width, media.height),
    codec: media.codec,
    bitDepth: media.bitDepth,
    colorTransfer: media.colorTransfer,
    hasAudio: media.hasAudio,
    shotType,
    motionType: input.motionType,
    movement: mapMovement(input.motionType),
    timeOfDay:
      clipInstant && hasPosition
        ? timeOfDay(clipInstant, input.lat as number, input.lon as number)
        : null,
    season:
      capture.localMonth && hasPosition ? seasonOf(capture.localMonth, input.lat as number) : null,
    capturedAt: clipInstant?.toISOString() ?? null,
    captureDate: capture.localDate,
    altitudeM: input.altitudeM,
    droneModel: media.model,
  };
};
