import fs from 'node:fs/promises';
import path from 'node:path';
import {
  secToFrame,
  SegmentationManifestSchema,
  type ConfirmResponse,
  type Project,
  type SegmentationManifest,
} from '@dfs/contracts';
import { conflict } from '../lib/errors.js';
import type { DataPaths } from '../lib/paths.js';
import type { ExportService } from './export.js';
import type { ProjectService } from './projects.js';
import type { SegmentService } from './segments.js';
import type { SegmentsConfirmedHandler } from './stage2.js';
import type { VideoService } from './videos.js';

/**
 * Validates, writes manifest.json, locks the project and notifies stage 2.
 * A confirmed project can be reopened: its export is discarded and it becomes an editable draft.
 */
export class ConfirmService {
  constructor(
    private readonly paths: DataPaths,
    private readonly projects: ProjectService,
    private readonly videos: VideoService,
    private readonly segments: SegmentService,
    private readonly exports: ExportService,
    private readonly stage2: SegmentsConfirmedHandler,
  ) {}

  buildManifest(projectId: string): SegmentationManifest {
    const project = this.projects.get(projectId);
    const videos = this.videos.listByProject(projectId).filter((v) => v.status === 'ready');
    const manifest: SegmentationManifest = {
      manifestVersion: 1,
      projectId,
      confirmedAt: new Date().toISOString(),
      settings: project.analysisSettings,
      videos: videos
        .map((v) => {
          const fps = v.fps ?? 0;
          const segments = this.segments
            .list(v.id)
            .filter((s) => s.accepted)
            .map((s) => {
              // Round to the nearest source frame; times are derived from frames.
              const startFrame = secToFrame(s.startSec, fps);
              const endFrame = secToFrame(s.endSec, fps);
              return {
                segmentId: s.id,
                startSec: startFrame / fps,
                endSec: endFrame / fps,
                startFrame,
                endFrame,
                motionType: s.motionType,
                score: s.score,
                origin: s.origin,
              };
            });
          return {
            videoId: v.id,
            originalFilename: v.originalFilename,
            sourcePath: v.storedPath ?? '',
            durationSec: v.durationSec ?? 0,
            fps,
            width: v.width ?? 0,
            height: v.height ?? 0,
            segments,
          };
        })
        .filter((v) => v.segments.length > 0),
    };
    return SegmentationManifestSchema.parse(manifest);
  }

  async confirm(projectId: string): Promise<ConfirmResponse> {
    this.projects.assertEditable(projectId);
    const summary = this.segments.summary(projectId);
    if (!summary.canConfirm) throw conflict(`Cannot confirm: ${summary.blockers.join('; ')}`);

    const manifest = this.buildManifest(projectId);
    const manifestPath = this.paths.manifest(projectId);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const tmp = `${manifestPath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.rename(tmp, manifestPath);

    // A re-confirm always regenerates from scratch, never reuses clips of an earlier manifest.
    await this.exports.reset(projectId);
    this.projects.markConfirmed(projectId, manifestPath);
    await this.stage2.onSegmentsConfirmed(manifest, manifestPath);
    return { manifestPath: this.paths.toHost(manifestPath), manifest };
  }

  async reopen(projectId: string): Promise<Project> {
    const project = this.projects.get(projectId);
    if (project.status !== 'confirmed') throw conflict('The project is not confirmed');
    await this.exports.reset(projectId);
    await fs.rm(this.paths.manifest(projectId), { force: true });
    return this.projects.markDraft(projectId);
  }
}
