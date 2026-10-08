import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SegmentationManifestSchema,
  type ClipMetadataPatch,
  type BulkKeywordsBody,
  type ExportClip,
  type ExportJob,
  type ExportState,
  type ExportVideo,
  type OllamaHealth,
  type StockCategories,
  type StockPlatformInfo,
  type PlatformValidation,
  type SegmentationManifest,
} from '@dfs/contracts';
import {
  assignFilenames,
  buildArchive,
  ExportPipeline,
  PipelineError,
  summarizeClips,
  type ClipRecord,
  type JobRecord,
  type PipelineSteps,
} from '@dfs/export-pipeline';
import { OllamaClient } from '@dfs/llm';
import {
  createAdapters,
  stockCategories,
  validationOf,
  type CsvClip,
  type StockConfig,
  type StockCsvAdapter,
} from '@dfs/stock-csv';
import type { FastifyBaseLogger } from 'fastify';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { exportDownloadUrl, type DataPaths } from '../lib/paths.js';
import type { EventBus } from './event-bus.js';
import type { DrizzleExportStore } from './export-store.js';
import type { ExportVideoSource } from './export-videos.js';
import type { ProjectService } from './projects.js';
import type { SettingsService } from './settings.js';
import type { VideoService } from './videos.js';

export interface ExportServiceDeps {
  store: DrizzleExportStore;
  bus: EventBus;
  paths: DataPaths;
  projects: ProjectService;
  videos: VideoService;
  videoSource: ExportVideoSource;
  settings: SettingsService;
  steps: PipelineSteps;
  log: FastifyBaseLogger;
  stock: StockConfig;
}

const isInside = (root: string, p: string): boolean => {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Converts pipeline errors into HTTP errors. */
const http = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PipelineError) throw new HttpError(err.statusCode, err.message);
    throw err;
  }
};

const httpAsync = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PipelineError) throw new HttpError(err.statusCode, err.message);
    throw err;
  }
};

/** Stage 2: export pipeline state, edits and SSE notifications for the API. */
export class ExportService {
  readonly pipeline: ExportPipeline;
  readonly adapters: StockCsvAdapter[];

  constructor(private readonly d: ExportServiceDeps) {
    this.adapters = createAdapters(d.stock);
    this.pipeline = new ExportPipeline({
      store: d.store,
      videos: d.videoSource,
      steps: d.steps,
      log: d.log,
      settings: () => d.settings.getExport(),
      events: {
        clipChanged: (clip) => this.publishClip(clip),
        clipProgress: (clip, progress) => {
          const job = d.store.getJob(clip.jobId);
          if (!job) return;
          d.bus.publish(job.projectId, {
            type: 'export.clip.progress',
            clipId: clip.id,
            status: clip.status,
            progress,
          });
        },
        jobChanged: (jobId) => {
          const job = d.store.getJob(jobId);
          if (job) d.bus.publish(job.projectId, { type: 'export.updated', job: this.toJob(job) });
        },
      },
    });
  }

  /** Called by stage 1 right after confirmation. */
  startFromManifest(manifest: SegmentationManifest, manifestPath: string): JobRecord {
    return this.pipeline.start(manifest, manifestPath);
  }

  /** Start (or resume) the export of a confirmed project from its manifest.json. */
  async start(projectId: string): Promise<ExportState> {
    const project = this.d.projects.get(projectId);
    if (project.status !== 'confirmed') throw conflict('Confirm the segments before exporting');
    const manifestPath = this.d.paths.manifest(projectId);
    let manifest: SegmentationManifest;
    try {
      manifest = SegmentationManifestSchema.parse(
        JSON.parse(await fs.readFile(manifestPath, 'utf8')),
      );
    } catch (err) {
      throw conflict(`manifest.json cannot be read: ${(err as Error).message}`);
    }
    this.pipeline.start(manifest, manifestPath);
    return this.state(projectId);
  }

  /** Ollama reachable and the configured model pulled? */
  async health(): Promise<OllamaHealth> {
    const { ollamaUrl, model } = this.d.settings.getExport();
    const result = await new OllamaClient({ baseUrl: ollamaUrl }).health(model);
    return { ...result, url: ollamaUrl, model };
  }

  resumeAll(): void {
    this.pipeline.resumeAll();
  }

  findJob(projectId: string): JobRecord | undefined {
    return this.d.store.findJobByProject(projectId);
  }

  getJob(projectId: string): JobRecord {
    const job = this.findJob(projectId);
    if (!job) throw notFound('Export');
    return job;
  }

  getClipRecord(clipId: string): ClipRecord {
    const clip = this.d.store.getClip(clipId);
    if (!clip) throw notFound('Clip');
    return clip;
  }

  state(projectId: string): ExportState {
    this.d.projects.get(projectId);
    const job = this.getJob(projectId);
    const records = this.d.store.listClips(job.id);
    const videoIds = [...new Set(records.map((c) => c.videoId))];
    const videos: ExportVideo[] = videoIds.flatMap((id) => {
      const row = this.d.videos.findRow(id);
      if (!row) return [];
      return [
        {
          id: row.id,
          originalFilename: row.originalFilename,
          manualLocation: row.manualLocation,
          embeddedLocation: row.mediaInfo?.location
            ? { lat: row.mediaInfo.location.lat, lon: row.mediaInfo.location.lon }
            : null,
          creationTime: row.mediaInfo?.creationTime ?? null,
          droneModel: row.mediaInfo?.model ?? null,
        },
      ];
    });
    const names = this.filenames(job.id, records);
    return {
      job: this.toJob(job, records),
      clips: records.map((c) => this.toClip(c, names.get(c.id) ?? null)),
      videos,
    };
  }

  // ---- clip actions ----

  patchMetadata(clipId: string, patch: ClipMetadataPatch): ExportClip {
    const clip = this.getClipRecord(clipId);
    if (!clip.metadata) throw conflict('The clip has no metadata yet');
    const { editorial, ...fields } = patch;
    const updated = this.pipeline.update(clipId, {
      metadata: { ...clip.metadata, ...fields },
      ...(editorial !== undefined ? { editorial } : {}),
    });
    return this.toClip(updated);
  }

  bulkKeywords(body: BulkKeywordsBody): ExportClip[] {
    const out: ExportClip[] = [];
    for (const id of body.clipIds) {
      const clip = this.getClipRecord(id);
      if (!clip.metadata) continue;
      const lower = (s: string) => s.toLowerCase();
      let keywords = clip.metadata.keywords;
      if (body.op === 'add') {
        if (!keywords.some((k) => lower(k) === lower(body.keyword))) {
          keywords = [...keywords, body.keyword.toLowerCase()];
        }
      } else if (body.op === 'remove') {
        keywords = keywords.filter((k) => lower(k) !== lower(body.keyword));
      } else {
        const seen = new Set<string>();
        keywords = keywords
          .map((k) => (lower(k) === lower(body.find) ? body.replace.toLowerCase() : k))
          .filter((k) => k && !seen.has(lower(k)) && seen.add(lower(k)));
      }
      out.push(this.toClip(this.pipeline.update(id, { metadata: { ...clip.metadata, keywords } })));
    }
    return out;
  }

  async retry(clipId: string): Promise<ExportClip> {
    return this.toClip(await httpAsync(() => this.pipeline.retry(clipId)));
  }

  async regenerate(clipId: string, opts: { hint?: string; poiName?: string }): Promise<ExportClip> {
    return this.toClip(await httpAsync(() => this.pipeline.regenerate(clipId, opts)));
  }

  approve(clipIds: string[]): ExportClip[] {
    return http(() => this.pipeline.approve(clipIds)).map((c) => this.toClip(c));
  }

  async setExcluded(clipId: string, excluded: boolean): Promise<ExportClip> {
    this.getClipRecord(clipId);
    return this.toClip(await this.pipeline.setExcluded(clipId, excluded));
  }

  /** Manual location of a video changed → re-run geo (and whatever depends on it) for its clips. */
  async setVideoLocation(videoId: string, location: string | null): Promise<ExportState | null> {
    const row = this.d.videos.getRow(videoId);
    const value = location?.trim() || null;
    this.d.videos.update(videoId, { manualLocation: value });
    const job = this.findJob(row.projectId);
    if (!job) return null;
    for (const clip of this.d.store.listClips(job.id)) {
      if (clip.videoId === videoId && clip.stepHashes.frames) {
        await this.pipeline.rerunFrom(clip.id, 'geo');
      }
    }
    return this.state(row.projectId);
  }

  async cancelProject(projectId: string): Promise<void> {
    const job = this.findJob(projectId);
    if (!job) return;
    await this.pipeline.cancelJob(job.id);
    await this.removeJobFiles(job);
  }

  /** Throw away the project's export (job, clips, work files, archive); no-op without a job. */
  async reset(projectId: string): Promise<void> {
    const job = this.findJob(projectId);
    if (!job) return;
    if (job.buildStatus === 'building') throw conflict('The archive is being built');
    await this.pipeline.discardJob(job.id);
    await this.removeJobFiles(job);
    this.d.bus.publish(projectId, { type: 'export.reset', projectId });
  }

  /** Discard the export and run every clip of the manifest through the whole pipeline again. */
  async regenerateAll(projectId: string): Promise<ExportState> {
    const project = this.d.projects.get(projectId);
    if (project.status !== 'confirmed') throw conflict('Confirm the segments before exporting');
    await this.reset(projectId);
    return this.start(projectId);
  }

  /**
   * Free disk space of a job: delete its encoded clips and the archive, keep frames, metadata
   * and AI output. Cut clips go back to "approved · waiting for encoding" so a later start
   * re-encodes them from the sources. Returns the number of clips reset.
   */
  async dropEncodedFiles(jobId: string): Promise<number> {
    const job = this.d.store.getJob(jobId);
    if (!job) throw notFound('Export job');
    if (job.buildStatus === 'building') throw conflict('The archive is being built');
    let reset = 0;
    for (const clip of this.d.store.listClips(job.id)) {
      const cutting = clip.status === 'cut';
      if (cutting) await this.pipeline.cancel(clip.id);
      await this.removeCutFiles(job.id, clip.cutPath, clip.id);
      if (!cutting && clip.status !== 'done' && !clip.cutPath) continue;
      const stepHashes = { ...clip.stepHashes };
      delete stepHashes.cut;
      const done = cutting || clip.status === 'done';
      this.pipeline.update(clip.id, {
        ...(done ? { status: 'review', approved: true, progress: 0 } : {}),
        cutPath: null,
        outputSizeBytes: null,
        stepHashes,
      });
      if (done) reset++;
    }
    if (job.archiveDir) await fs.rm(job.archiveDir, { recursive: true, force: true });
    if (job.archiveZip) await fs.rm(job.archiveZip, { force: true });
    this.d.store.updateJob(job.id, {
      buildStatus: 'idle',
      buildError: null,
      archive: null,
      archiveDir: null,
      archiveZip: null,
      archiveHash: null,
    });
    const updated = this.d.store.getJob(job.id);
    if (updated) {
      this.d.bus.publish(job.projectId, { type: 'export.updated', job: this.toJob(updated) });
    }
    return reset;
  }

  /** Encoded output of a clip: the recorded cutPath and any cut.* / cut.part.* leftovers. */
  private async removeCutFiles(jobId: string, cutPath: string | null, clipId: string) {
    const dir = this.d.paths.clipWork(jobId, clipId);
    if (cutPath && isInside(this.d.paths.root, cutPath)) await fs.rm(cutPath, { force: true });
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.startsWith('cut.')) await fs.rm(path.join(dir, name), { force: true });
    }
  }

  private async removeJobFiles(job: JobRecord): Promise<void> {
    await fs.rm(this.d.paths.exportWork(job.id), { recursive: true, force: true });
    if (job.archiveDir) await fs.rm(job.archiveDir, { recursive: true, force: true });
    if (job.archiveZip) await fs.rm(job.archiveZip, { force: true });
  }

  // ---- archive ----

  /** Delivery file names of all clips in a job (unique, identical in every CSV). */
  filenames(jobId: string, clips = this.d.store.listClips(jobId)): Map<string, string> {
    const s = this.d.settings.getExport();
    return assignFilenames(clips, s.filenameTemplate, s.encoding.container);
  }

  /** Start building the archive in the background; progress/result arrive as `export.updated`. */
  startBuild(projectId: string): ExportJob {
    const job = this.getJob(projectId);
    const clips = this.d.store.listClips(job.id);
    if (job.buildStatus === 'building') throw conflict('The archive is already being built');
    if (!summarizeClips(clips).canBuild) {
      throw conflict('Every clip must be done or excluded before building the archive');
    }
    const updated = this.d.store.updateJob(job.id, { buildStatus: 'building', buildError: null });
    this.publishJob(updated);
    void this.build(updated).catch(() => undefined);
    return this.toJob(updated);
  }

  /** Builds (or reuses) the export folder + ZIP. */
  async build(job: JobRecord): Promise<JobRecord> {
    try {
      const project = this.d.projects.get(job.projectId);
      const records = this.d.store.listClips(job.id);
      const names = this.filenames(job.id, records);
      const done = records.filter((c) => !c.excluded && c.status === 'done');
      const result = await buildArchive({
        projectName: project.name,
        clips: done.map((record) => ({
          record,
          filename: names.get(record.id) ?? `${record.id}.mov`,
          originalFilename: this.d.videos.findRow(record.videoId)?.originalFilename ?? '',
        })),
        excludedCount: records.filter((c) => c.excluded).length,
        adapters: this.enabledAdapters(),
        settings: this.d.settings.getExport(),
        exportsRoot: this.d.paths.exportsRoot,
        clipDir: (jobId, clipId) => this.d.paths.clipWork(jobId, clipId),
        now: new Date(),
        previous: { hash: job.archiveHash, dir: job.archiveDir, zip: job.archiveZip },
      });
      for (const c of done) {
        const filename = names.get(c.id) ?? null;
        if (c.filename !== filename) this.d.store.updateClip(c.id, { filename });
      }
      this.d.log.info(
        { jobId: job.id, reused: result.reused, zip: result.zip },
        'export archive ready',
      );
      const updated = this.d.store.updateJob(job.id, {
        buildStatus: 'built',
        buildError: null,
        archiveDir: result.dir,
        archiveZip: result.zip,
        archiveHash: result.hash,
        archive: {
          builtAt: new Date().toISOString(),
          folderPath: this.d.paths.toHost(result.dir),
          zipUrl: exportDownloadUrl(job.id),
          zipSizeBytes: result.zipSizeBytes,
          reportMd: result.reportMd,
          clipCount: done.length,
        },
      });
      this.publishJob(updated);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.d.log.error({ jobId: job.id, err: message }, 'export archive failed');
      const updated = this.d.store.updateJob(job.id, {
        buildStatus: 'failed',
        buildError: message,
      });
      this.publishJob(updated);
      throw err;
    }
  }

  /** Path of the built ZIP for download. */
  zipPath(jobId: string): string {
    const job = this.d.store.getJob(jobId);
    if (!job?.archiveZip || job.buildStatus !== 'built') throw notFound('Archive');
    return job.archiveZip;
  }

  private publishJob(job: JobRecord): void {
    this.d.bus.publish(job.projectId, { type: 'export.updated', job: this.toJob(job) });
  }

  // ---- mapping ----

  /** Adapters of the platforms enabled in settings. */
  enabledAdapters(): StockCsvAdapter[] {
    const enabled = new Set(this.d.settings.getExport().enabledPlatforms);
    return this.adapters.filter((a) => enabled.has(a.id));
  }

  platforms(): StockPlatformInfo[] {
    return this.adapters.map((a) => ({
      id: a.id,
      label: a.label,
      lastVerified: a.lastVerified,
      verified: a.verified,
    }));
  }

  categories(): StockCategories {
    return stockCategories(this.d.stock);
  }

  /** CSV view of a clip (null until metadata and tech context exist). */
  csvClip(clip: ClipRecord, filename = clip.filename): CsvClip | null {
    if (!clip.metadata || !clip.tech) return null;
    return {
      filename: filename ?? 'pending.mov',
      metadata: clip.metadata,
      editorial: clip.editorial ?? clip.metadata.editorialSuggested,
      geo: clip.geo,
      tech: clip.tech,
      outputSizeBytes: clip.outputSizeBytes,
    };
  }

  /** Per-platform validation badges computed by the stock CSV adapters. */
  private validate(clip: ClipRecord, filename: string | null): PlatformValidation[] {
    const csv = this.csvClip(clip, filename);
    if (!csv) return [];
    const ctx = { settings: this.d.settings.getExport(), exportDate: new Date() };
    return this.enabledAdapters().map((a) => validationOf(a.id, a.toRow(csv, ctx).issues));
  }

  toClip(clip: ClipRecord, filename = this.filenames(clip.jobId).get(clip.id) ?? null): ExportClip {
    const video = this.d.videos.findRow(clip.videoId);
    return {
      id: clip.id,
      jobId: clip.jobId,
      videoId: clip.videoId,
      segmentId: clip.segmentId,
      ordinal: clip.ordinal,
      originalFilename: video?.originalFilename ?? '',
      startSec: clip.startSec,
      endSec: clip.endSec,
      motionType: clip.motionType,
      status: clip.status,
      progress: clip.progress,
      failedStep: clip.failedStep,
      error: clip.error,
      excluded: clip.excluded,
      approved: clip.approved,
      // Rows written before `cameraHeadingDeg` existed lack the field.
      context: {
        frames: clip.frames,
        geo: clip.geo ? { ...clip.geo, cameraHeadingDeg: clip.geo.cameraHeadingDeg ?? null } : null,
        tech: clip.tech,
      },
      metadata: clip.metadata,
      editorial: clip.editorial ?? clip.metadata?.editorialSuggested ?? false,
      generation: clip.generation,
      userHint: clip.userHint,
      poiOverride: clip.poiOverride,
      filename,
      outputSizeBytes: clip.outputSizeBytes,
      validations: clip.metadata ? this.validate(clip, filename) : [],
      updatedAt: clip.updatedAt,
    };
  }

  toJob(job: JobRecord, clips = this.d.store.listClips(job.id)): ExportJob {
    const summary = summarizeClips(clips);
    return {
      id: job.id,
      projectId: job.projectId,
      createdAt: job.createdAt,
      total: summary.total,
      excluded: summary.excluded,
      counts: summary.counts,
      progress: summary.progress,
      canBuild: summary.canBuild && job.buildStatus !== 'building',
      buildStatus: job.buildStatus,
      buildError: job.buildError,
      archive: job.archive,
    };
  }

  private publishClip(clip: ClipRecord): void {
    const job = this.d.store.getJob(clip.jobId);
    if (job)
      this.d.bus.publish(job.projectId, { type: 'export.clip.updated', clip: this.toClip(clip) });
  }
}
