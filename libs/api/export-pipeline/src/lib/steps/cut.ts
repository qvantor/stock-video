import fs from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '@dfs/ffmpeg';
import type { EncodingSettings, TechContext } from '@dfs/contracts';
import { hashOf } from '../hash.js';
import type { ClipRecord, PipelineStep } from '../types.js';
import type { StepDeps } from './deps.js';

const UHD_PIXELS = 3840 * 2160;

export interface CutPlan {
  sourcePath: string;
  startSec: number;
  frameCount: number;
  width: number;
  height: number;
  /** Conform rate for slow motion (every source frame kept, played slower), or null. */
  conformFps: number | null;
  encoding: EncodingSettings;
  embedGps: boolean;
  /** UTC capture time of the clip start, written as creation_time. */
  creationTime: string | null;
  output: string;
}

/** ffmpeg arguments for a frame-accurate re-encode of one clip (no audio). */
export const cutArgs = (plan: CutPlan): string[] => {
  const filters: string[] = [];
  if (plan.conformFps) filters.push(`setpts=N/(${plan.conformFps}*TB)`);
  const enc = plan.encoding;
  let codec: string[];
  if (enc.codec === 'prores_hq') {
    filters.push('format=yuv422p10le');
    // prettier-ignore
    codec = ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0'];
  } else {
    filters.push('format=yuv420p');
    const scale = Math.min(1, (plan.width * plan.height) / UHD_PIXELS);
    const maxrate = Math.max(10, Math.round(enc.maxBitrateMbps * scale));
    // prettier-ignore
    codec = [
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow',
      '-crf', String(enc.crf), '-maxrate', `${maxrate}M`, '-bufsize', `${maxrate * 2}M`,
    ];
  }
  const gps = plan.embedGps
    ? []
    : [
        '-metadata',
        'location=',
        '-metadata',
        'location-eng=',
        '-metadata',
        'com.apple.quicktime.location.ISO6709=',
      ];
  // prettier-ignore
  return [
    '-y',
    '-ss', plan.startSec.toFixed(6),
    '-i', plan.sourcePath,
    '-map', '0:v:0',
    '-an', '-sn', '-dn',
    '-frames:v', String(plan.frameCount),
    '-vf', filters.join(','),
    ...(plan.conformFps ? ['-r', String(plan.conformFps)] : ['-fps_mode', 'passthrough']),
    ...codec,
    '-map_metadata', '0',
    ...gps,
    ...(plan.creationTime ? ['-metadata', `creation_time=${plan.creationTime}`] : []),
    '-movflags', '+faststart',
    plan.output,
  ];
};

const conformOf = (tech: TechContext): number | null =>
  tech.shotType === 'slow_motion' ? tech.outputFps : null;

const exists = (p: string | null) =>
  p
    ? fs.access(p).then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);

/** Frame-accurate cut with re-encoding (stream copy can only cut on keyframes). */
export const cutStep = (deps: StepDeps): PipelineStep => ({
  name: 'cut',

  hash: ({ clip, video, settings }) =>
    hashOf(
      'cut.v1',
      video.sourcePath,
      clip.startFrame,
      clip.endFrame,
      video.media.fps,
      settings.encoding,
      clip.tech ? conformOf(clip.tech) : null,
      settings.embedGps,
      clip.tech?.capturedAt ?? null,
    ),

  isComplete: (clip: ClipRecord) => exists(clip.cutPath),

  run: async ({ clip, video, settings, signal, onProgress }) => {
    if (!clip.tech) throw new Error('Technical context is missing');
    const dir = deps.clipDir(clip.jobId, clip.id);
    await fs.mkdir(dir, { recursive: true });
    const ext = settings.encoding.container;
    const output = path.join(dir, `cut.${ext}`);
    const part = path.join(dir, `cut.part.${ext}`);
    const frameCount = Math.max(1, clip.endFrame - clip.startFrame);
    await runFfmpeg(
      deps.ffmpegPath,
      cutArgs({
        sourcePath: video.sourcePath,
        // Seek to the frame boundary used by the manifest.
        startSec: clip.startFrame / video.media.fps,
        frameCount,
        width: video.media.width,
        height: video.media.height,
        conformFps: conformOf(clip.tech),
        encoding: settings.encoding,
        embedGps: settings.embedGps,
        creationTime: clip.tech.capturedAt,
        output: part,
      }),
      { durationSec: clip.tech.durationSec, onProgress, signal },
    );
    await fs.rename(part, output);
    // Remove a cut in the other container left over from earlier settings.
    for (const other of ['mov', 'mp4']) {
      if (other !== ext) await fs.rm(path.join(dir, `cut.${other}`), { force: true });
    }
    const { size } = await fs.stat(output);
    return { cutPath: output, outputSizeBytes: size };
  },
});
