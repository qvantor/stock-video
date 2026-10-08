import type { MotionType, ShotType } from '@dfs/contracts';

export interface ShotTypeInput {
  /** Source frame rate. */
  fps: number;
  /** Selected conform rate for high-frame-rate footage, or null when conform is off. */
  conformFps: number | null;
  /** Clip duration on the video timeline. */
  durationSec: number;
  /** Real elapsed time of the clip (e.g. from telemetry timestamps), if known. */
  realElapsedSec?: number | null;
  originalFilename: string;
  /** Container/stream tags (lower-cased keys). */
  tags: Record<string, string>;
  motionType: MotionType;
}

export interface ShotTypeConfig {
  /** realElapsed / duration above this ratio → timelapse. */
  timelapseRatio: number;
  /** Frame rates at or above this are high-frame-rate footage. */
  highFrameRateFps: number;
}

export const DEFAULT_SHOT_TYPE_CONFIG: ShotTypeConfig = {
  timelapseRatio: 1.5,
  highFrameRateFps: 100,
};

const HYPERLAPSE = /hyper[\s_-]?lapse|(^|[_\W])hyp[_\W]/i;
const TIMELAPSE = /time[\s_-]?lapse|(^|[_\W])tl[_\W]/i;

/**
 * Deterministic shot type:
 * - hyperlapse/timelapse from file name or DJI metadata, or when real time ≫ video time;
 * - slow_motion when ≥100 fps footage is conformed to 25/30 fps, otherwise high_frame_rate;
 * - real_time otherwise.
 */
export const detectShotType = (
  input: ShotTypeInput,
  config: ShotTypeConfig = DEFAULT_SHOT_TYPE_CONFIG,
): ShotType => {
  const name = input.originalFilename;
  const tagText = Object.values(input.tags).join(' ');
  if (HYPERLAPSE.test(name) || HYPERLAPSE.test(tagText)) return 'hyperlapse';
  if (TIMELAPSE.test(name) || TIMELAPSE.test(tagText)) {
    return input.motionType === 'static' ? 'timelapse' : 'hyperlapse';
  }
  if (
    input.realElapsedSec &&
    input.durationSec > 0 &&
    input.realElapsedSec / input.durationSec > config.timelapseRatio
  ) {
    return input.motionType === 'static' ? 'timelapse' : 'hyperlapse';
  }
  if (input.fps >= config.highFrameRateFps) {
    return input.conformFps ? 'slow_motion' : 'high_frame_rate';
  }
  return 'real_time';
};

/** Playback frame rate of the delivered clip. */
export const outputFps = (fps: number, shotType: ShotType, conformFps: number | null): number =>
  shotType === 'slow_motion' && conformFps ? conformFps : fps;

/** Delivered duration: conformed slow motion plays every source frame at the lower rate. */
export const outputDuration = (
  sourceDurationSec: number,
  fps: number,
  shotType: ShotType,
  conformFps: number | null,
): number =>
  shotType === 'slow_motion' && conformFps
    ? (sourceDurationSec * fps) / conformFps
    : sourceDurationSec;
