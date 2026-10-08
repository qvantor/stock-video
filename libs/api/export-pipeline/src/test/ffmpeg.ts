import { spawnSync } from 'node:child_process';

export const hasFfmpeg = (): boolean =>
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

/** Synthetic clip; `pixFmt` yuv420p10le + libx265 mimics 10-bit drone footage. */
export const makeClip = (
  file: string,
  opts: {
    seconds: number;
    fps?: number;
    size?: string;
    codec?: 'libx264' | 'libx265';
    pixFmt?: string;
  },
): void => {
  const codec = opts.codec ?? 'libx264';
  // prettier-ignore
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=${opts.size ?? '1280x720'}:rate=${opts.fps ?? 30}:duration=${opts.seconds}`,
    '-c:v', codec, '-preset', 'ultrafast', '-pix_fmt', opts.pixFmt ?? 'yuv420p',
    ...(codec === 'libx265' ? ['-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : []),
    file,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
};

/** Width of the first video stream / image. */
export const widthOf = (file: string): number => {
  // prettier-ignore
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file]);
  return Number(r.stdout.toString().trim());
};
