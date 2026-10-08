import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_EXPORT_SETTINGS } from '@dfs/contracts';
import { probeDetailed } from '@dfs/ffmpeg';
import { cutArgs, cutStep, type CutPlan } from './cut.js';
import type { StepDeps } from './deps.js';
import type { ClipRecord, StepContext } from '../types.js';
import { media, silentLog } from '../../test/fixtures.js';
import { hasFfmpeg, makeClip } from '../../test/ffmpeg.js';

const plan = (over: Partial<CutPlan> = {}): CutPlan => ({
  sourcePath: '/src.mp4',
  startSec: 10,
  frameCount: 300,
  width: 3840,
  height: 2160,
  conformFps: null,
  encoding: DEFAULT_EXPORT_SETTINGS.encoding,
  embedGps: false,
  creationTime: '2024-07-14T18:30:10.000Z',
  output: '/out.mov',
  ...over,
});

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('cutArgs', () => {
  it('H.264 High 8-bit, no audio, faststart, exact frame count, GPS removed', () => {
    const a = cutArgs(plan());
    expect(arg(a, '-c:v')).toBe('libx264');
    expect(arg(a, '-profile:v')).toBe('high');
    expect(arg(a, '-vf')).toBe('format=yuv420p');
    expect(arg(a, '-frames:v')).toBe('300');
    expect(arg(a, '-maxrate')).toBe('100M');
    expect(a).toContain('-an');
    expect(a).toContain('+faststart');
    expect(a).toContain('location=');
    expect(a).toContain('creation_time=2024-07-14T18:30:10.000Z');
  });

  it('scales the bitrate cap for smaller frames and keeps GPS when asked', () => {
    const a = cutArgs(plan({ width: 1920, height: 1080, embedGps: true }));
    expect(arg(a, '-maxrate')).toBe('25M');
    expect(a).not.toContain('location=');
  });

  it('conforms slow motion without dropping frames', () => {
    const a = cutArgs(plan({ conformFps: 25 }));
    expect(arg(a, '-vf')).toBe('setpts=N/(25*TB),format=yuv420p');
    expect(arg(a, '-r')).toBe('25');
  });

  it('ProRes 422 HQ profile', () => {
    const a = cutArgs(
      plan({ encoding: { ...DEFAULT_EXPORT_SETTINGS.encoding, codec: 'prores_hq' } }),
    );
    expect(arg(a, '-c:v')).toBe('prores_ks');
    expect(arg(a, '-profile:v')).toBe('3');
    expect(arg(a, '-vf')).toBe('format=yuv422p10le');
  });
});

const frameCount = (file: string): number => {
  // prettier-ignore
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]);
  return Number(r.stdout.toString().trim());
};

describe.skipIf(!hasFfmpeg())('cut step (ffmpeg)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-cut-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = async (src: string, over: Partial<ClipRecord>, conform: '25' | 'off') => {
    const info = await probeDetailed('ffprobe', src);
    const step = cutStep({
      ffmpegPath: 'ffmpeg',
      clipDir: (j: string, c: string) => path.join(dir, j, c),
    } as StepDeps);
    const clip = {
      id: `c-${conform}`,
      jobId: 'j',
      startFrame: 0,
      endFrame: 0,
      tech: { shotType: 'real_time', outputFps: info.fps, durationSec: 1, capturedAt: null },
      ...over,
    } as ClipRecord;
    const ctx = {
      clip,
      video: { sourcePath: src, media: media({ ...info }) },
      settings: {
        ...DEFAULT_EXPORT_SETTINGS,
        encoding: { ...DEFAULT_EXPORT_SETTINGS.encoding, crf: 28 },
      },
      signal: new AbortController().signal,
      log: silentLog,
      onProgress: () => undefined,
    } as unknown as StepContext;
    return step.run(ctx);
  };

  it('cuts exactly the manifest frames', async () => {
    const src = path.join(dir, 'src30.mp4');
    makeClip(src, { seconds: 4, fps: 30, size: '640x360' });
    const patch = await run(src, { startFrame: 31, endFrame: 91 }, 'off');
    expect(frameCount(patch.cutPath as string)).toBe(60);
    const out = await probeDetailed('ffprobe', patch.cutPath as string);
    expect(out).toMatchObject({ codec: 'h264', hasAudio: false, bitDepth: 8 });
    expect(patch.outputSizeBytes).toBeGreaterThan(0);
  }, 120_000);

  it('conforms 100 fps to 25 fps: all frames kept, 4× longer', async () => {
    const src = path.join(dir, 'src100.mp4');
    makeClip(src, { seconds: 2, fps: 100, size: '320x180' });
    const patch = await run(
      src,
      {
        startFrame: 0,
        endFrame: 100,
        tech: {
          shotType: 'slow_motion',
          outputFps: 25,
          durationSec: 4,
          capturedAt: null,
        } as ClipRecord['tech'],
      },
      '25',
    );
    const out = await probeDetailed('ffprobe', patch.cutPath as string);
    expect(frameCount(patch.cutPath as string)).toBe(100);
    expect(out.fps).toBeCloseTo(25, 1);
    expect(out.durationSec).toBeCloseTo(4, 1);
  }, 120_000);
});
