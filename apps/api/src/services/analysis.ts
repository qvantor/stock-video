import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  snapToFrame,
  type AnalysisSettings,
  type Segment,
  type VideoMetrics,
} from '@dfs/contracts';
import {
  ANALYSIS_CONFIG,
  analysisSize,
  ffmpegGrayFrames,
  segmentFeatures,
  type FrameFeatures,
  type MotionAnalyzer,
} from '@dfs/video-analysis';
import type { DataPaths } from '../lib/paths.js';
import type { VideoAnalysisStep } from './processing.js';
import type { ProjectService } from './projects.js';
import type { SegmentService } from './segments.js';
import type { VideoService } from './videos.js';

const FeatureCacheSchema = z.object({
  analysisFps: z.number(),
  width: z.number(),
  height: z.number(),
  features: z.array(
    z.object({
      t: z.number(),
      dx: z.number(),
      dy: z.number(),
      div: z.number(),
      rot: z.number(),
      px: z.number(),
      py: z.number(),
      fit: z.number(),
      coherence: z.number(),
      magVar: z.number(),
      sharpness: z.number(),
      brightness: z.number(),
      overexposed: z.number(),
    }),
  ),
});
type FeatureCache = z.infer<typeof FeatureCacheSchema>;

const round = (v: number, digits = 5) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Motion analysis step: decode low-res gray frames → MotionAnalyzer → cache
 * features → segment. Re-analysis with new parameters reuses the cached
 * features unless the analysis frame rate changed.
 */
export class AnalysisService implements VideoAnalysisStep {
  /** Per-video override of settings for the next queued analysis (POST /videos/:id/reanalyze). */
  private readonly pendingSettings = new Map<string, AnalysisSettings>();

  constructor(
    private readonly analyzer: MotionAnalyzer,
    private readonly ffmpegPath: string,
    private readonly paths: DataPaths,
    private readonly projects: ProjectService,
    private readonly videos: VideoService,
    private readonly segments: SegmentService,
  ) {}

  async analyze(
    videoId: string,
    onProgress: (f: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const row = this.videos.getRow(videoId);
    const settings =
      this.pendingSettings.get(videoId) ?? this.projects.get(row.projectId).analysisSettings;
    this.pendingSettings.delete(videoId);
    if (!row.width || !row.height || !row.durationSec || !row.fps)
      throw new Error('Video metadata is missing');

    let cache = await this.readCache(videoId);
    if (!cache || cache.analysisFps !== settings.analysisFps) {
      // The 720p proxy decodes much faster than a 4K HEVC source and has the same timeline.
      const input = row.hasProxy ? this.paths.proxy(videoId) : row.storedPath;
      if (!input) throw new Error('No file to analyse');
      const size = analysisSize(row.width, row.height, ANALYSIS_CONFIG.analysisWidth);
      const stream = ffmpegGrayFrames({
        ffmpegPath: this.ffmpegPath,
        input,
        fps: settings.analysisFps,
        ...size,
        durationSec: row.durationSec,
        signal,
      });
      const features = await this.analyzer.analyze(stream.frames, stream.info, {
        signal,
        onProgress: (f) => onProgress(f * 0.97),
      });
      if (features.length < 2) throw new Error('The video is too short to analyse');
      cache = { analysisFps: settings.analysisFps, ...size, features: features.map(roundFeatures) };
      await fs.writeFile(this.paths.features(videoId), JSON.stringify(cache));
    }
    signal.throwIfAborted();
    await this.segmentFromCache(videoId, cache, settings);
    onProgress(1);
  }

  /**
   * Re-run segmentation with new parameters. Returns 'segmented' when cached
   * features could be reused, 'queued' when a new feature extraction is needed.
   */
  async reanalyze(
    videoId: string,
    settings: AnalysisSettings,
    enqueue: (videoId: string) => void,
  ): Promise<'segmented' | 'queued'> {
    // New AI proposals invalidate an earlier review.
    if (this.videos.getRow(videoId).reviewed) this.videos.update(videoId, { reviewed: false });
    const cache = await this.readCache(videoId);
    if (cache && cache.analysisFps === settings.analysisFps) {
      await this.segmentFromCache(videoId, cache, settings);
      return 'segmented';
    }
    this.pendingSettings.set(videoId, settings);
    enqueue(videoId);
    return 'queued';
  }

  private async segmentFromCache(videoId: string, cache: FeatureCache, settings: AnalysisSettings) {
    const row = this.videos.getRow(videoId);
    const fps = row.fps ?? cache.analysisFps;
    const duration = row.durationSec ?? Infinity;
    const result = segmentFeatures(cache.features, cache.analysisFps, settings);

    const proposals: Segment[] = result.segments.map((s) => ({
      id: randomUUID(),
      videoId,
      // Snap to source frames so the manifest/cutting is frame-exact.
      startSec: snapToFrame(Math.max(0, s.startSec), fps),
      endSec: snapToFrame(Math.min(duration, s.endSec), fps),
      motionType: s.motionType,
      score: s.score,
      reasons: s.reasons,
      origin: 'ai',
      accepted: true,
      edited: false,
    }));
    this.segments.replaceAiSegments(videoId, proposals);

    const metrics: VideoMetrics = {
      fps: cache.analysisFps,
      t: cache.features.map((f) => round(f.t + 0.5 / cache.analysisFps, 3)),
      speed: result.speed,
      smoothness: result.smoothness,
      motion: result.labels,
    };
    await fs.writeFile(this.paths.metrics(videoId), JSON.stringify(metrics));
  }

  private async readCache(videoId: string): Promise<FeatureCache | null> {
    try {
      return FeatureCacheSchema.parse(
        JSON.parse(await fs.readFile(this.paths.features(videoId), 'utf8')),
      );
    } catch {
      return null;
    }
  }
}

const roundFeatures = (f: FrameFeatures): FrameFeatures => ({
  t: round(f.t, 4),
  dx: round(f.dx),
  dy: round(f.dy),
  div: round(f.div),
  rot: round(f.rot),
  px: round(f.px),
  py: round(f.py),
  fit: round(f.fit, 4),
  coherence: round(f.coherence, 4),
  magVar: round(f.magVar, 8),
  sharpness: round(f.sharpness, 2),
  brightness: round(f.brightness, 2),
  overexposed: round(f.overexposed, 5),
});
