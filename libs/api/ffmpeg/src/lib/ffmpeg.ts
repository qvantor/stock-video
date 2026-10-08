import { spawn } from 'node:child_process';
import { probeDetailed } from './probe.js';

export interface FfmpegBinaries {
  ffmpegPath: string;
  ffprobePath: string;
}

export class MissingBinaryError extends Error {}

const runVersion = (bin: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, ['-version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out.split('\n')[0] ?? '') : reject(new Error(`exit code ${code}`)),
    );
  });

/** Verify ffmpeg/ffprobe can be executed; throws a human-readable error otherwise. */
export const checkBinaries = async (bins: FfmpegBinaries): Promise<string[]> => {
  const versions: string[] = [];
  for (const [name, bin] of [
    ['ffmpeg', bins.ffmpegPath],
    ['ffprobe', bins.ffprobePath],
  ] as const) {
    try {
      versions.push(await runVersion(bin));
    } catch (err) {
      throw new MissingBinaryError(
        `${name} was not found or cannot be run (${bin}): ${(err as Error).message}.\n` +
          `Install ffmpeg (macOS: \`brew install ffmpeg\`) or run the API in Docker ` +
          `(\`pnpm dev:api\`). The path can be set via ${name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'}.`,
      );
    }
  }
  return versions;
};

export interface RunOptions {
  /** Called with 0..1 progress, computed from `-progress pipe:1` out_time against durationSec. */
  onProgress?: (fraction: number) => void;
  durationSec?: number;
  signal?: AbortSignal;
}

/** Run ffmpeg with the given args; rejects with the tail of stderr on failure. */
export const runFfmpeg = (bin: string, args: string[], opts: RunOptions = {}): Promise<void> =>
  new Promise((resolve, reject) => {
    const withProgress = opts.onProgress ? ['-progress', 'pipe:1', '-nostats'] : [];
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', ...withProgress, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: opts.signal,
    });
    let stderr = '';
    let buf = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.stdout.on('data', (d: Buffer) => {
      if (!opts.onProgress || !opts.durationSec) return;
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) opts.onProgress(Math.min(1, Number(m[1]) / 1e6 / opts.durationSec));
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || 'no output'}`));
    });
  });

export interface ProbeResult {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
}

/** Basic properties used by stage 1 (proxy, analysis). */
export const ffprobe = async (bin: string, file: string): Promise<ProbeResult> => {
  const info = await probeDetailed(bin, file);
  return {
    durationSec: info.durationSec,
    fps: info.fps,
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
};
