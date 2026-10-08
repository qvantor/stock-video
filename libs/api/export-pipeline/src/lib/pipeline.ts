import { randomUUID } from 'node:crypto';
import PQueue from 'p-queue';
import type { ClipStatus, ClipStep, ExportSettings, SegmentationManifest } from '@dfs/contracts';
import { isTerminal } from './progress.js';
import type {
  ClipPatch,
  ClipRecord,
  ExportStore,
  JobRecord,
  Logger,
  PipelineSteps,
  StepContext,
  VideoSource,
} from './types.js';

const NEXT: Record<ClipStep, ClipStatus> = {
  frames: 'geo',
  geo: 'tech',
  tech: 'llm',
  llm: 'review',
  cut: 'done',
};

export interface PipelineEvents {
  /** A clip changed (status, data, error...). */
  clipChanged(clip: ClipRecord): void;
  /** Progress within the current step (throttled by the caller if needed). */
  clipProgress(clip: ClipRecord, progress: number): void;
  /** Counts/progress of the job changed. */
  jobChanged(jobId: string): void;
}

export interface ExportPipelineDeps {
  store: ExportStore;
  videos: VideoSource;
  steps: PipelineSteps;
  events: PipelineEvents;
  log: Logger;
  settings: () => ExportSettings;
}

interface Running {
  ac: AbortController;
  done: Promise<void>;
}

const PROGRESS_STEP = 0.02;

/**
 * Per-clip export pipeline: queued → frames → geo → tech → llm → review → cut → done | failed.
 *
 * Every step is idempotent: its result is persisted together with a hash of its inputs, so after a
 * crash or restart a clip continues from its current status and completed steps are skipped.
 * LLM calls run strictly one at a time; all other steps share a small concurrent queue.
 */
export class ExportPipeline {
  private readonly general: PQueue;
  private readonly llm = new PQueue({ concurrency: 1 });
  private readonly scheduled = new Set<string>();
  private readonly running = new Map<string, Running>();
  private readonly lastProgress = new Map<string, number>();

  constructor(private readonly deps: ExportPipelineDeps) {
    this.general = new PQueue({ concurrency: deps.settings().concurrency });
  }

  /** Create (or reuse) the project's export job from a confirmed manifest and start processing. */
  start(manifest: SegmentationManifest, manifestPath: string): JobRecord {
    const { store } = this.deps;
    let job = store.findJobByProject(manifest.projectId);
    if (!job) {
      job = {
        id: randomUUID(),
        projectId: manifest.projectId,
        manifestPath,
        createdAt: new Date().toISOString(),
        buildStatus: 'idle',
        buildError: null,
        archive: null,
        archiveDir: null,
        archiveZip: null,
        archiveHash: null,
      };
      store.createJob(job);
    }
    const existing = new Set(store.listClips(job.id).map((c) => c.segmentId));
    let ordinal = existing.size;
    const now = new Date().toISOString();
    const fresh: ClipRecord[] = [];
    for (const video of manifest.videos) {
      for (const seg of video.segments) {
        if (existing.has(seg.segmentId)) continue;
        fresh.push({
          id: randomUUID(),
          jobId: job.id,
          videoId: video.videoId,
          segmentId: seg.segmentId,
          ordinal: ordinal++,
          startSec: seg.startSec,
          endSec: seg.endSec,
          startFrame: seg.startFrame,
          endFrame: seg.endFrame,
          motionType: seg.motionType,
          status: 'queued',
          progress: 0,
          failedStep: null,
          error: null,
          excluded: false,
          approved: false,
          frames: null,
          geo: null,
          tech: null,
          generation: null,
          metadata: null,
          editorial: null,
          userHint: null,
          poiOverride: null,
          stepHashes: {},
          cutPath: null,
          outputSizeBytes: null,
          filename: null,
          updatedAt: now,
        });
      }
    }
    if (fresh.length) store.insertClips(fresh);
    for (const clip of store.listClips(job.id)) {
      // Approved clips waiting in review (e.g. after their encoded files were cleaned up) are cut.
      const awaitingCut = clip.status === 'review' && clip.approved;
      if (!clip.excluded && (!isTerminal(clip.status) || awaitingCut)) this.schedule(clip.id);
    }
    this.deps.events.jobChanged(job.id);
    return job;
  }

  /** Re-enqueue clips interrupted by a restart. */
  resumeAll(): void {
    for (const clip of this.deps.store.listUnfinishedClips()) {
      if (!clip.excluded) this.schedule(clip.id);
    }
  }

  /** Re-run a failed clip from the step that failed. */
  async retry(clipId: string): Promise<ClipRecord> {
    await this.cancel(clipId);
    const clip = this.getClip(clipId);
    if (clip.status !== 'failed') throw new PipelineError('Only failed clips can be retried');
    const updated = this.update(clip.id, {
      status: clip.failedStep ?? 'queued',
      failedStep: null,
      error: null,
      progress: 0,
    });
    this.schedule(clipId);
    return updated;
  }

  /**
   * Re-run the LLM step (optionally with a user hint / chosen POI). Earlier steps are reused,
   * the cut is reused if its inputs did not change.
   */
  async regenerate(
    clipId: string,
    opts: { hint?: string; poiName?: string } = {},
  ): Promise<ClipRecord> {
    await this.cancel(clipId);
    const clip = this.getClip(clipId);
    if (!clip.stepHashes.tech) {
      throw new PipelineError('The clip has not reached the metadata step yet');
    }
    const hashes = { ...clip.stepHashes };
    delete hashes.llm;
    const updated = this.update(clip.id, {
      status: 'llm',
      failedStep: null,
      error: null,
      progress: 0,
      approved: false,
      userHint: opts.hint?.trim() || null,
      poiOverride: opts.poiName?.trim() || null,
      stepHashes: hashes,
    });
    this.schedule(clipId);
    return updated;
  }

  /** Re-run from a given step onward (e.g. after the video location changed). Unchanged steps are skipped by hash. */
  async rerunFrom(clipId: string, step: ClipStep): Promise<ClipRecord> {
    await this.cancel(clipId);
    const clip = this.getClip(clipId);
    if (clip.status === 'queued' || clip.status === 'frames') {
      this.schedule(clipId);
      return clip;
    }
    const updated = this.update(clip.id, {
      status: step,
      failedStep: null,
      error: null,
      progress: 0,
    });
    if (!clip.excluded) this.schedule(clipId);
    return updated;
  }

  /** Approve reviewed metadata → the clip proceeds to cutting. */
  approve(clipIds: string[]): ClipRecord[] {
    const out: ClipRecord[] = [];
    for (const id of clipIds) {
      const clip = this.getClip(id);
      if (clip.status !== 'review' || clip.excluded) continue;
      out.push(this.update(id, { approved: true }));
      this.schedule(id);
    }
    return out;
  }

  /** Exclude a clip from the export (or include it again). */
  async setExcluded(clipId: string, excluded: boolean): Promise<ClipRecord> {
    if (excluded) await this.cancel(clipId);
    const updated = this.update(clipId, { excluded });
    if (!excluded && !isTerminal(updated.status)) this.schedule(clipId);
    else if (!excluded && updated.status === 'review') this.schedule(clipId);
    return updated;
  }

  /** Stop all processing of a job (project deletion). */
  async cancelJob(jobId: string): Promise<void> {
    for (const clip of this.deps.store.listClips(jobId)) await this.cancel(clip.id);
  }

  /** Stop all processing of a job and delete it with its clips (full regeneration). */
  async discardJob(jobId: string): Promise<void> {
    await this.cancelJob(jobId);
    this.deps.store.deleteJob(jobId);
  }

  /** Abort processing of a clip and wait until it has stopped. */
  async cancel(clipId: string): Promise<void> {
    this.scheduled.delete(clipId);
    const task = this.running.get(clipId);
    if (!task) return;
    task.ac.abort();
    await task.done;
  }

  async onIdle(): Promise<void> {
    // A clip may move from one queue to the other; wait until both are drained.
    while (this.general.size || this.general.pending || this.llm.size || this.llm.pending) {
      await Promise.all([this.general.onIdle(), this.llm.onIdle()]);
    }
  }

  /** Apply a patch to a clip and notify listeners. */
  update(clipId: string, patch: ClipPatch): ClipRecord {
    const clip = this.deps.store.updateClip(clipId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.deps.events.clipChanged(clip);
    if (patch.status !== undefined || patch.excluded !== undefined)
      this.deps.events.jobChanged(clip.jobId);
    return clip;
  }

  private getClip(clipId: string): ClipRecord {
    const clip = this.deps.store.getClip(clipId);
    if (!clip) throw new PipelineError('Clip not found', 404);
    return clip;
  }

  private schedule(clipId: string): void {
    if (this.scheduled.has(clipId)) return;
    const clip = this.deps.store.getClip(clipId);
    if (!clip || clip.excluded) return;
    this.scheduled.add(clipId);
    const queue = clip.status === 'llm' ? this.llm : this.general;
    void queue.add(() => this.process(clipId));
  }

  private async process(clipId: string): Promise<void> {
    if (!this.scheduled.delete(clipId)) return; // cancelled while queued
    const ac = new AbortController();
    const done = this.execute(clipId, ac.signal);
    this.running.set(clipId, { ac, done });
    let next: ClipStatus | null = null;
    try {
      next = await done.then(() => this.deps.store.getClip(clipId)?.status ?? null);
    } finally {
      this.running.delete(clipId);
    }
    // Hand over to the other queue (LLM ↔ general) when the clip crossed that boundary.
    if (!ac.signal.aborted && next && !isTerminal(next)) this.schedule(clipId);
    else if (!ac.signal.aborted && next === 'review') {
      const clip = this.deps.store.getClip(clipId);
      if (clip && (clip.approved || this.deps.settings().autoApprove)) this.schedule(clipId);
    }
  }

  /** Runs steps until the clip finishes, waits for review or must switch queues; never throws. */
  private async execute(clipId: string, signal: AbortSignal): Promise<void> {
    let step: ClipStep | null = null;
    try {
      const startedInLlm = this.deps.store.getClip(clipId)?.status === 'llm';
      for (;;) {
        signal.throwIfAborted();
        let clip = this.deps.store.getClip(clipId);
        if (!clip || clip.excluded) return;
        if (clip.status === 'queued') clip = this.update(clipId, { status: 'frames', progress: 0 });
        if (clip.status === 'review') {
          if (!clip.approved && !this.deps.settings().autoApprove) return;
          clip = this.update(clipId, { status: 'cut', approved: true, progress: 0 });
        }
        if (clip.status === 'done' || clip.status === 'failed') return;
        step = clip.status as ClipStep;
        // LLM work only runs on the LLM queue and vice versa.
        if ((step === 'llm') !== startedInLlm) return;

        await this.runStep(clip, step, signal);
        step = null;
      }
    } catch (err) {
      if (signal.aborted || !this.deps.store.getClip(clipId)) return;
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log.error({ clipId, step, err: message }, 'export step failed');
      this.update(clipId, { status: 'failed', failedStep: step, error: message, progress: 0 });
    }
  }

  private async runStep(clip: ClipRecord, name: ClipStep, signal: AbortSignal): Promise<void> {
    const step = this.deps.steps[name];
    const job = this.deps.store.getJob(clip.jobId);
    if (!job) throw new Error('Export job not found');
    const video = await this.deps.videos.getVideo(clip.videoId);
    const log = this.deps.log;
    const ctx: StepContext = {
      clip,
      video,
      job,
      settings: this.deps.settings(),
      signal,
      log,
      onProgress: (f) => this.progress(clip, f),
    };
    const hash = await step.hash(ctx);
    if (clip.stepHashes[name] === hash && (await step.isComplete(clip))) {
      log.debug({ clipId: clip.id, step: name }, 'export step unchanged, skipped');
      this.update(clip.id, { status: NEXT[name], progress: 0 });
      return;
    }
    const started = Date.now();
    log.info({ clipId: clip.id, step: name }, 'export step started');
    const patch = await step.run(ctx);
    signal.throwIfAborted();
    const advance: ClipPatch = name === 'llm' ? { approved: this.deps.settings().autoApprove } : {};
    this.update(clip.id, {
      ...patch,
      ...advance,
      stepHashes: { ...this.deps.store.getClip(clip.id)?.stepHashes, [name]: hash },
      status: NEXT[name],
      progress: 0,
      failedStep: null,
      error: null,
    });
    log.info({ clipId: clip.id, step: name, ms: Date.now() - started }, 'export step done');
  }

  private progress(clip: ClipRecord, fraction: number): void {
    const value = Math.max(0, Math.min(1, fraction));
    const prev = this.lastProgress.get(clip.id) ?? -1;
    if (Math.abs(value - prev) < PROGRESS_STEP && value !== 1) return;
    this.lastProgress.set(clip.id, value);
    const updated = this.deps.store.updateClip(clip.id, { progress: value });
    this.deps.events.clipProgress(updated, value);
  }
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}
