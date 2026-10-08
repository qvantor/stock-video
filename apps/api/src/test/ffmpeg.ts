import { spawnSync } from 'node:child_process';

export const hasFfmpeg = (): boolean =>
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

/** Generate a short synthetic test clip (HEVC to mimic drone sources when available). */
export const makeTestClip = (
  file: string,
  seconds: number,
  codec: 'libx265' | 'libx264' = 'libx265',
): void => {
  // prettier-ignore
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    '-c:v', codec, '-pix_fmt', 'yuv420p', '-tag:v', codec === 'libx265' ? 'hvc1' : 'avc1',
    file,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString()}`);
};

/** A clip panning across a multi-scale texture: content slides left (camera pans right). */
export const makePanClip = (dir: string, file: string, seconds: number, pxPerSec: number): void => {
  const pattern = `${dir}/pattern.png`;
  const width = 1280 + Math.ceil(pxPerSec * seconds) + 16;
  // prettier-ignore
  const still = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `nullsrc=s=${width}x720,format=gray`,
    '-vf', "geq=lum='128+50*sin(X/23)*cos(Y/17)+35*sin((X+2*Y)/61)+25*sin(X/7+Y/11)+15*cos(X/150-Y/90)'",
    '-frames:v', '1', pattern,
  ]);
  if (still.status !== 0) throw new Error(`ffmpeg pattern failed: ${still.stderr?.toString()}`);
  // prettier-ignore
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', pattern,
    '-vf', `crop=1280:720:x='t*${pxPerSec}':y=0,format=yuv420p`,
    '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
    file,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg pan clip failed: ${r.stderr?.toString()}`);
};
