import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { probeDetailed, readDjiTelemetry, type TelemetryPoint } from '@dfs/ffmpeg';
import type { SharpnessSeries, VideoInput, VideoSource } from '@dfs/export-pipeline';
import type { DataPaths } from '../lib/paths.js';
import type { VideoService } from './videos.js';

const SharpnessCacheSchema = z.object({
  features: z.array(z.object({ t: z.number(), sharpness: z.number() }).loose()),
});

const TelemetryCacheSchema = z.object({
  schema: z.string().nullable(),
  points: z.array(
    z.object({ t: z.number(), lat: z.number(), lon: z.number(), altitudeM: z.number().nullable() }),
  ),
});

/**
 * Source videos for stage 2: probes container metadata lazily, reads the DJI telemetry track
 * (cached in telemetry.json next to the video) and stage-1 sharpness.
 */
export class ExportVideoSource implements VideoSource {
  private readonly telemetryLoads = new Map<string, Promise<TelemetryPoint[] | null>>();

  constructor(
    private readonly videos: VideoService,
    private readonly paths: DataPaths,
    private readonly bins: { ffmpegPath: string; ffprobePath: string },
  ) {}

  async getVideo(videoId: string): Promise<VideoInput> {
    const row = this.videos.getRow(videoId);
    if (!row.storedPath) throw new Error('The source file of the video is missing');
    let media = row.mediaInfo;
    // `djiMetaStream` was added later: re-probe rows stored before it existed.
    if (!media || media.djiMetaStream === undefined) {
      media = await probeDetailed(this.bins.ffprobePath, row.storedPath);
      this.videos.update(videoId, { mediaInfo: media });
    }
    if (!media.location) {
      const first = (await this.getTelemetry(videoId))?.[0];
      if (first) {
        // The first GPS fix of the track doubles as the video's embedded location.
        media = {
          ...media,
          location: { lat: first.lat, lon: first.lon, altitudeM: first.altitudeM },
        };
        this.videos.update(videoId, { mediaInfo: media });
      }
    }
    return {
      id: row.id,
      projectId: row.projectId,
      originalFilename: row.originalFilename,
      sourcePath: row.storedPath,
      media,
      manualLocation: row.manualLocation,
    };
  }

  async getSharpness(videoId: string): Promise<SharpnessSeries | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.paths.features(videoId), 'utf8'));
      const { features } = SharpnessCacheSchema.parse(raw);
      return { t: features.map((f) => f.t), sharpness: features.map((f) => f.sharpness) };
    } catch {
      return null;
    }
  }

  getTelemetry(videoId: string): Promise<TelemetryPoint[] | null> {
    let load = this.telemetryLoads.get(videoId);
    if (!load) {
      // Telemetry is optional: a broken or unknown stream must never fail the clip.
      load = this.loadTelemetry(videoId)
        .catch(() => null)
        .finally(() => this.telemetryLoads.delete(videoId));
      this.telemetryLoads.set(videoId, load);
    }
    return load;
  }

  private async loadTelemetry(videoId: string): Promise<TelemetryPoint[] | null> {
    const file = path.join(this.paths.videoDir(videoId), 'telemetry.json');
    try {
      const cached = TelemetryCacheSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
      return cached.points.length ? cached.points : null;
    } catch {
      // not cached yet
    }
    const row = this.videos.getRow(videoId);
    let stream = row.mediaInfo?.djiMetaStream;
    if (stream === undefined && row.storedPath) {
      const media = await probeDetailed(this.bins.ffprobePath, row.storedPath);
      this.videos.update(videoId, { mediaInfo: media });
      stream = media.djiMetaStream;
    }
    const result =
      stream !== null && stream !== undefined && row.storedPath
        ? await readDjiTelemetry(this.bins, row.storedPath, stream)
        : null;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(result ?? { schema: null, points: [] }));
    return result?.points.length ? result.points : null;
  }
}
