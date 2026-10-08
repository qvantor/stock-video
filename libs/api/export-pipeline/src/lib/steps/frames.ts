import fs from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '@dfs/ffmpeg';
import type { ClipFrame } from '@dfs/contracts';
import { hashOf } from '../hash.js';
import type { ClipRecord, PipelineStep, SharpnessSeries, VideoInput } from '../types.js';
import type { StepDeps } from './deps.js';

/** Clips shorter than this get a single frame from the middle. */
const SHORT_CLIP_SEC = 15;
/** Search window around each target point for the sharpest sample. */
const WINDOW_SEC = 1;
/** Long side of the frame sent to the model. */
const LLM_FRAME_SIZE = 1280;

export interface FramePick {
  timeSec: number;
  sharpness: number | null;
}

/**
 * Frame times for a clip: ~30% and ~70% of its length (50% for short clips), each moved to the
 * sharpest stage-1 sample (Laplacian variance) within ±1 s.
 */
export const pickFrameTimes = (
  startSec: number,
  endSec: number,
  sharpness: SharpnessSeries | null,
): FramePick[] => {
  const duration = endSec - startSec;
  const points = duration < SHORT_CLIP_SEC ? [0.5] : [0.3, 0.7];
  const margin = Math.min(0.1, duration / 10);
  return points.map((p) => {
    const target = startSec + p * duration;
    const lo = Math.max(startSec + margin, target - WINDOW_SEC);
    const hi = Math.min(endSec - margin, target + WINDOW_SEC);
    let best: FramePick = { timeSec: target, sharpness: null };
    if (sharpness) {
      sharpness.t.forEach((t, i) => {
        const v = sharpness.sharpness[i];
        if (t < lo || t > hi || v === undefined || !Number.isFinite(v)) return;
        if (best.sharpness === null || v > best.sharpness) best = { timeSec: t, sharpness: v };
      });
    }
    return { timeSec: Math.round(best.timeSec * 1000) / 1000, sharpness: best.sharpness };
  });
};

/** 10-bit, log and HDR material looks flat/grey to the model: stretch contrast for the model frame. */
export const needsNormalization = (media: VideoInput['media']): boolean =>
  media.bitDepth > 8 ||
  media.colorTransfer === 'log' ||
  media.colorTransfer === 'hlg' ||
  media.colorTransfer === 'pq';

export const frameFile = (index: number, variant: 'full' | 'llm'): string =>
  `frame_${index}${variant === 'llm' ? '_llm' : ''}.jpg`;

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

export const framesStep = (deps: StepDeps): PipelineStep => ({
  name: 'frames',

  hash: ({ clip, video }) =>
    hashOf(
      'frames.v1',
      video.sourcePath,
      clip.startSec,
      clip.endSec,
      needsNormalization(video.media),
    ),

  isComplete: async (clip: ClipRecord) => {
    if (!clip.frames?.length) return false;
    const dir = deps.clipDir(clip.jobId, clip.id);
    for (const f of clip.frames) {
      if (!(await exists(path.join(dir, frameFile(f.index, 'full'))))) return false;
      if (!(await exists(path.join(dir, frameFile(f.index, 'llm'))))) return false;
    }
    return true;
  },

  run: async ({ clip, video, signal, onProgress }) => {
    const dir = deps.clipDir(clip.jobId, clip.id);
    await fs.mkdir(dir, { recursive: true });
    const sharpness = await deps.videos.getSharpness(video.id);
    const picks = pickFrameTimes(clip.startSec, clip.endSec, sharpness);
    const normalize = needsNormalization(video.media);
    const frames: ClipFrame[] = [];

    for (const [index, pick] of picks.entries()) {
      const full = path.join(dir, frameFile(index, 'full'));
      const llm = path.join(dir, frameFile(index, 'llm'));
      // Seeking before -i is frame-accurate when decoding.
      // prettier-ignore
      await runFfmpeg(deps.ffmpegPath, [
        '-y', '-ss', pick.timeSec.toFixed(3), '-i', video.sourcePath,
        '-frames:v', '1', '-an', '-sn', '-dn',
        '-vf', 'format=yuvj420p', '-q:v', '2',
        `${full}.part.jpg`,
      ], { signal });
      await fs.rename(`${full}.part.jpg`, full);

      const scale = `scale=w=${LLM_FRAME_SIZE}:h=${LLM_FRAME_SIZE}:force_original_aspect_ratio=decrease`;
      const filters = normalize
        ? `${scale},normalize=smoothing=0:independence=0:strength=0.9,eq=saturation=1.3`
        : scale;
      // prettier-ignore
      await runFfmpeg(deps.ffmpegPath, [
        '-y', '-i', full, '-vf', filters, '-q:v', '3', `${llm}.part.jpg`,
      ], { signal });
      await fs.rename(`${llm}.part.jpg`, llm);

      frames.push({
        index,
        timeSec: pick.timeSec,
        sharpness: pick.sharpness,
        url: deps.frameUrl(clip.id, index),
      });
      onProgress((index + 1) / picks.length);
    }
    return { frames };
  },
});
