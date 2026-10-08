import { asc, eq, notInArray } from 'drizzle-orm';
import type { ClipPatch, ClipRecord, ExportStore, JobPatch, JobRecord } from '@dfs/export-pipeline';
import type { Db } from '../db/client.js';
import { exportClips, exportJobs } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

/** Drizzle/SQLite implementation of the export pipeline's persistence port. */
export class DrizzleExportStore implements ExportStore {
  constructor(private readonly db: Db) {}

  findJobByProject(projectId: string): JobRecord | undefined {
    return this.db.select().from(exportJobs).where(eq(exportJobs.projectId, projectId)).get();
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).get();
  }

  createJob(job: JobRecord): void {
    this.db.insert(exportJobs).values(job).run();
  }

  /** Clips are removed by the FK cascade. */
  deleteJob(jobId: string): void {
    this.db.delete(exportJobs).where(eq(exportJobs.id, jobId)).run();
  }

  updateJob(jobId: string, patch: JobPatch): JobRecord {
    const row = this.db
      .update(exportJobs)
      .set(patch)
      .where(eq(exportJobs.id, jobId))
      .returning()
      .get();
    if (!row) throw notFound('Export job');
    return row;
  }

  listClips(jobId: string): ClipRecord[] {
    return this.db
      .select()
      .from(exportClips)
      .where(eq(exportClips.jobId, jobId))
      .orderBy(asc(exportClips.ordinal))
      .all();
  }

  getClip(clipId: string): ClipRecord | undefined {
    return this.db.select().from(exportClips).where(eq(exportClips.id, clipId)).get();
  }

  insertClips(clips: ClipRecord[]): void {
    this.db.transaction((tx) => {
      for (const c of clips) tx.insert(exportClips).values(c).run();
    });
  }

  updateClip(clipId: string, patch: ClipPatch): ClipRecord {
    const row = this.db
      .update(exportClips)
      .set(patch)
      .where(eq(exportClips.id, clipId))
      .returning()
      .get();
    if (!row) throw notFound('Clip');
    return row;
  }

  listUnfinishedClips(): ClipRecord[] {
    return this.db
      .select()
      .from(exportClips)
      .where(notInArray(exportClips.status, ['review', 'done', 'failed']))
      .all();
  }
}
