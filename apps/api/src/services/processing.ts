import fs from 'node:fs/promises';
import PQueue from 'p-queue';
import type { FastifyBaseLogger } from 'fastify';
import { fileFingerprint, fileSha256 } from '../lib/fingerprint.js';
import type { DataPaths } from '../lib/paths.js';
import type { MediaTools } from './media.js';
import type { VideoRow } from '../db/schema.js';
import type { VideoPatch, VideoService } from './videos.js';

/** Analysis step of the pipeline (motion analysis + segmentation). */
export interface VideoAnalysisStep {
  analyze(videoId: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<void>;
}

/**
 * In-process processing queue: probing → proxy (+ sprite) → analyzing → ready | failed.
 * Concurrency = number of videos processed at once.
 */
export class ProcessingQueue {
  private readonly queue: PQueue;
  private readonly running = new Map<string, { ac: AbortController; done: Promise<void> }>();
  private readonly pending = new Set<string>();

  constructor(
    concurrency: number,
    private readonly videos: VideoService,
    private readonly media: MediaTools,
    private readonly analysis: VideoAnalysisStep,
    private readonly paths: DataPaths,
    private readonly log: FastifyBaseLogger,
  ) {
    this.queue = new PQueue({ concurrency });
  }

  enqueue(videoId: string): void {
    if (this.pending.has(videoId) || this.running.has(videoId)) return;
    this.pending.add(videoId);
    this.videos.update(videoId, { status: 'queued', progress: 0, error: null });
    void this.queue.add(() => this.process(videoId));
  }

  /**
   * Abort processing of a video (e.g. it is being deleted) and wait until the
   * running task has stopped, so no ffmpeg process writes into its folder afterwards.
   */
  async cancel(videoId: string): Promise<void> {
    this.pending.delete(videoId);
    const task = this.running.get(videoId);
    if (!task) return;
    task.ac.abort();
    await task.done;
  }

  /** Re-enqueue videos interrupted by a restart. */
  resumeInterrupted(): void {
    for (const row of this.videos.listByStatus(['queued', 'probing', 'proxy', 'analyzing'])) {
      if (row.storedPath) this.enqueue(row.id);
    }
  }

  /**
   * Fill fingerprint, content hash and detailed metadata of settled videos stored
   * before duplicate detection existed. Runs one video at a time after regular work.
   */
  backfillHashes(): void {
    for (const row of this.videos.listMissingHashes()) {
      void this.queue.add(
        async () => {
          if (this.pending.has(row.id) || this.running.has(row.id)) return;
          try {
            const current = this.videos.findRow(row.id);
            if (current?.storedPath) await this.identify(current);
          } catch (err) {
            this.log.warn({ videoId: row.id, err }, 'could not hash a stored video');
          }
        },
        { priority: -1 },
      );
    }
  }

  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  private async process(videoId: string): Promise<void> {
    if (!this.pending.delete(videoId)) return; // cancelled while queued
    const ac = new AbortController();
    const done = this.execute(videoId, ac.signal);
    this.running.set(videoId, { ac, done });
    try {
      await done;
    } finally {
      this.running.delete(videoId);
    }
  }

  /** Runs the pipeline and records the outcome; never throws. */
  private async execute(videoId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.runPipeline(videoId, signal);
      if (!signal.aborted)
        this.videos.update(videoId, { status: 'ready', progress: 1, error: null });
    } catch (err) {
      if (signal.aborted || !this.videos.findRow(videoId)) return;
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ videoId, err }, 'video processing failed');
      this.videos.update(videoId, { status: 'failed', error: message });
    }
  }

  /**
   * Hash the source file, read its full metadata and link it to an earlier
   * identical video (any project), if there is one.
   */
  private async identify(
    row: VideoRow,
    onProgress?: (f: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!row.storedPath) return;
    const patch: VideoPatch = {};
    if (!row.contentHash) {
      // The client may have sent a fingerprint; never trust it, recompute.
      patch.fingerprint = await fileFingerprint(row.storedPath);
      patch.contentHash = await fileSha256(row.storedPath, onProgress, signal);
    } else if (!row.fingerprint) {
      patch.fingerprint = await fileFingerprint(row.storedPath);
    }
    if (!row.mediaInfo) patch.mediaInfo = await this.media.probeDetailed(row.storedPath);
    signal?.throwIfAborted();
    const updated = { ...row, ...patch };
    const duplicateOfId = this.videos.findEarlierDuplicate(updated)?.id ?? null;
    if (duplicateOfId !== row.duplicateOfId) patch.duplicateOfId = duplicateOfId;
    if (Object.keys(patch).length > 0) this.videos.update(row.id, patch);
  }

  private async runPipeline(videoId: string, signal: AbortSignal): Promise<void> {
    const row = this.videos.getRow(videoId);
    if (!row.storedPath) throw new Error('The source file is missing');
    await fs.access(row.storedPath);

    this.videos.update(videoId, { status: 'probing', progress: 0 });
    const probe = await this.media.probe(row.storedPath);
    this.videos.update(videoId, { ...probe, progress: 0.05 });
    signal.throwIfAborted();
    await this.identify(
      this.videos.getRow(videoId),
      (f) => this.videos.setProgress(videoId, 'probing', 0.05 + f * 0.95),
      signal,
    );
    signal.throwIfAborted();

    const proxyPath = this.paths.proxy(videoId);
    if (!row.hasProxy || !row.spriteMeta) {
      this.videos.update(videoId, { status: 'proxy', progress: 0 });
      await this.media.makeProxy(
        row.storedPath,
        proxyPath,
        probe.durationSec,
        (f) => this.videos.setProgress(videoId, 'proxy', f * 0.9),
        signal,
      );
      this.videos.update(videoId, { hasProxy: true, progress: 0.9 });
      const spriteMeta = await this.media.makeSprite(
        proxyPath,
        this.paths.sprite(videoId),
        probe.durationSec,
        signal,
      );
      this.videos.update(videoId, { spriteMeta, progress: 1 });
    }
    signal.throwIfAborted();

    this.videos.update(videoId, { status: 'analyzing', progress: 0 });
    await this.analysis.analyze(
      videoId,
      (f) => this.videos.setProgress(videoId, 'analyzing', f),
      signal,
    );
  }
}
