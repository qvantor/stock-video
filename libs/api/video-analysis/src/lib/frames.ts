import { spawn } from 'node:child_process';
import type { FrameSourceInfo } from './types.js';

export interface GrayFrameStream {
  info: FrameSourceInfo;
  frames: AsyncIterable<Uint8Array>;
}

/** Even analysis height for a given width keeping the source aspect ratio. */
export const analysisSize = (srcWidth: number, srcHeight: number, width: number) => ({
  width,
  height: Math.max(2, Math.round((width * srcHeight) / srcWidth / 2) * 2),
});

/**
 * Decode a video into raw 8-bit grayscale frames at reduced fps/resolution via an
 * ffmpeg pipe (no intermediate files). Frames are yielded as exact-size buffers.
 */
export const ffmpegGrayFrames = (opts: {
  ffmpegPath: string;
  input: string;
  fps: number;
  width: number;
  height: number;
  durationSec?: number;
  signal?: AbortSignal;
}): GrayFrameStream => {
  const { width, height, fps } = opts;
  const frameSize = width * height;
  // prettier-ignore
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-i', opts.input,
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    'pipe:1',
  ];

  async function* frames(): AsyncGenerator<Uint8Array> {
    const child = spawn(opts.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    let pending: Buffer = Buffer.alloc(0);
    try {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length >= frameSize) {
          // Copy into a standalone buffer so it can be transferred to a worker.
          yield new Uint8Array(pending.subarray(0, frameSize));
          pending = pending.subarray(frameSize);
        }
      }
      const code = await exited;
      if (code !== 0)
        throw new Error(`ffmpeg (analysis frames) exited with code ${code}: ${stderr.trim()}`);
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }

  return {
    info: {
      width,
      height,
      fps,
      expectedFrames: opts.durationSec ? Math.floor(opts.durationSec * fps) : undefined,
    },
    frames: frames(),
  };
};
