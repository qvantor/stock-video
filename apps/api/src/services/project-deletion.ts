import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { projects } from '../db/schema.js';
import type { DataPaths } from '../lib/paths.js';
import type { EventBus } from './event-bus.js';
import type { ExportService } from './export.js';
import type { ProcessingQueue } from './processing.js';
import type { ProjectService } from './projects.js';
import type { VideoService } from './videos.js';

/**
 * Deletes a project with everything that belongs to it: processing and export are stopped,
 * export work files and archives are removed,
 * each video's folder (original, proxy, sprite, analysis cache) and unfinished
 * tus uploads are removed, then the DB rows (segments cascade) and the
 * project folder with manifest.json.
 */
export class ProjectDeletionService {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly paths: DataPaths,
    private readonly projects: ProjectService,
    private readonly videos: VideoService,
    private readonly queue: ProcessingQueue,
    private readonly exports: ExportService,
  ) {}

  async delete(projectId: string): Promise<void> {
    this.projects.get(projectId);
    await this.exports.cancelProject(projectId);
    for (const video of this.videos.listByProject(projectId)) {
      await this.queue.cancel(video.id);
      const row = this.videos.findRow(video.id);
      if (row?.uploadId) await this.removeUpload(row.uploadId);
      await this.videos.remove(video.id);
    }
    this.db.delete(projects).where(eq(projects.id, projectId)).run();
    await fs.rm(this.paths.projectDir(projectId), { recursive: true, force: true });
    this.bus.publish(projectId, { type: 'project.deleted', projectId });
  }

  private async removeUpload(uploadId: string): Promise<void> {
    const file = path.join(this.paths.uploads, uploadId);
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.json`, { force: true });
  }
}
