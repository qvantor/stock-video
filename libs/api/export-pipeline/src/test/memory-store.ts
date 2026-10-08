import type { ClipPatch, ClipRecord, ExportStore, JobPatch, JobRecord } from '../lib/types.js';
import { isTerminal } from '../lib/progress.js';

/** In-memory ExportStore for unit tests. */
export class MemoryStore implements ExportStore {
  readonly jobs = new Map<string, JobRecord>();
  readonly clips = new Map<string, ClipRecord>();

  findJobByProject(projectId: string): JobRecord | undefined {
    return [...this.jobs.values()].find((j) => j.projectId === projectId);
  }
  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }
  createJob(job: JobRecord): void {
    this.jobs.set(job.id, structuredClone(job));
  }
  updateJob(jobId: string, patch: JobPatch): JobRecord {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error('job not found');
    const job = { ...current, ...patch };
    this.jobs.set(jobId, job);
    return structuredClone(job);
  }
  deleteJob(jobId: string): void {
    this.jobs.delete(jobId);
    for (const c of [...this.clips.values()]) if (c.jobId === jobId) this.clips.delete(c.id);
  }
  listClips(jobId: string): ClipRecord[] {
    return [...this.clips.values()]
      .filter((c) => c.jobId === jobId)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => structuredClone(c));
  }
  getClip(clipId: string): ClipRecord | undefined {
    const c = this.clips.get(clipId);
    return c && structuredClone(c);
  }
  insertClips(clips: ClipRecord[]): void {
    for (const c of clips) this.clips.set(c.id, structuredClone(c));
  }
  updateClip(clipId: string, patch: ClipPatch): ClipRecord {
    const current = this.clips.get(clipId);
    if (!current) throw new Error('clip not found');
    const clip = { ...current, ...structuredClone(patch) };
    this.clips.set(clipId, clip);
    return structuredClone(clip);
  }
  listUnfinishedClips(): ClipRecord[] {
    return [...this.clips.values()]
      .filter((c) => !isTerminal(c.status))
      .map((c) => structuredClone(c));
  }
}
