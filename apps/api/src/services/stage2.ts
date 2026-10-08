import type { FastifyBaseLogger } from 'fastify';
import type { SegmentationManifest } from '@dfs/contracts';
import type { ExportService } from './export.js';

/**
 * Hand-off point to stage 2 (cutting, geolocation, titles, tags, stock CSV).
 * Called once after a project's segments are confirmed and manifest.json is written.
 */
export interface SegmentsConfirmedHandler {
  onSegmentsConfirmed(manifest: SegmentationManifest, manifestPath: string): Promise<void>;
}

/** Starts the export pipeline for the confirmed segments (processing continues in the background). */
export class ExportStage2Handler implements SegmentsConfirmedHandler {
  constructor(
    private readonly exports: ExportService,
    private readonly log: FastifyBaseLogger,
  ) {}

  async onSegmentsConfirmed(manifest: SegmentationManifest, manifestPath: string): Promise<void> {
    const job = this.exports.startFromManifest(manifest, manifestPath);
    this.log.info({ projectId: manifest.projectId, jobId: job.id }, 'export pipeline started');
  }
}
