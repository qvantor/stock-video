import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpriteMeta } from '@dfs/contracts';
import { ffprobe, probeDetailed, runFfmpeg, type MediaInfo, type ProbeResult } from '@dfs/ffmpeg';

export interface MediaToolsConfig {
  ffmpegPath: string;
  ffprobePath: string;
}

/** Thumbnail width in the sprite sheet (px). */
const SPRITE_TILE_WIDTH = 160;
const SPRITE_COLUMNS = 10;
/** Default seconds between thumbnails; grows for long videos to cap the sheet size. */
const SPRITE_MIN_INTERVAL = 2;
const SPRITE_MAX_THUMBS = 600;
/** Proxy height for landscape footage (shorter side for portrait). */
const PROXY_SHORT_SIDE = 720;

export class MediaTools {
  constructor(private readonly cfg: MediaToolsConfig) {}

  probe(file: string): Promise<ProbeResult> {
    return ffprobe(this.cfg.ffprobePath, file);
  }

  /** Full container/stream metadata (creation time, GPS, camera, tags). */
  probeDetailed(file: string): Promise<MediaInfo> {
    return probeDetailed(this.cfg.ffprobePath, file);
  }

  /**
   * Browser-friendly H.264 8-bit proxy (DJI sources are often 10-bit HEVC).
   * Short GOP keeps seeking / frame stepping precise. Written atomically.
   */
  async makeProxy(
    src: string,
    dest: string,
    durationSec: number,
    onProgress: (f: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const tmp = `${dest}.part.mp4`;
    const s = PROXY_SHORT_SIDE;
    // prettier-ignore
    await runFfmpeg(
      this.cfg.ffmpegPath,
      [
        '-y',
        '-i', src,
        '-map', '0:v:0',
        '-an', '-sn', '-dn',
        '-vf', `scale='if(gte(iw,ih),-2,min(${s},iw))':'if(gte(iw,ih),min(${s},ih),-2)',format=yuv420p`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-g', '15',
        '-keyint_min', '15',
        '-sc_threshold', '0',
        '-fps_mode', 'passthrough',
        '-movflags', '+faststart',
        tmp,
      ],
      { durationSec, onProgress, signal },
    );
    await fs.rename(tmp, dest);
  }

  /** Thumbnail sprite sheet from the proxy (cheap to decode) + its layout. */
  async makeSprite(
    proxy: string,
    dest: string,
    durationSec: number,
    signal?: AbortSignal,
  ): Promise<SpriteMeta> {
    const { width, height } = await this.probe(proxy);
    const interval = Math.max(SPRITE_MIN_INTERVAL, durationSec / SPRITE_MAX_THUMBS);
    const count = Math.max(1, Math.ceil(durationSec / interval));
    const rows = Math.ceil(count / SPRITE_COLUMNS);
    const tileHeight = Math.max(2, Math.round((SPRITE_TILE_WIDTH * height) / width / 2) * 2);
    const tmp = path.join(path.dirname(dest), `sprite.part.jpg`);
    // prettier-ignore
    await runFfmpeg(
      this.cfg.ffmpegPath,
      [
        '-y',
        '-i', proxy,
        '-vf', `fps=1/${interval},scale=${SPRITE_TILE_WIDTH}:${tileHeight},tile=${SPRITE_COLUMNS}x${rows}`,
        '-frames:v', '1',
        '-q:v', '5',
        '-update', '1',
        tmp,
      ],
      { signal },
    );
    await fs.rename(tmp, dest);
    return {
      interval,
      tileWidth: SPRITE_TILE_WIDTH,
      tileHeight,
      columns: SPRITE_COLUMNS,
      rows,
      count,
    };
  }
}
