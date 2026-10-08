import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  STORAGE_CATEGORIES,
  type StorageBreakdown,
  type StorageCategory,
  type StorageCleanupResult,
  type StorageUsage,
} from '@dfs/contracts';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { exportClips, exportJobs, projects, videos } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import type { DataPaths } from '../lib/paths.js';
import type { ExportService } from './export.js';

interface StorageDeps {
  config: Pick<AppConfig, 'dbPath'>;
  db: Db;
  paths: DataPaths;
  exports: ExportService;
}

interface FileEntry {
  path: string;
  bytes: number;
  category: StorageCategory;
  /** Owning project; null for leftovers that belong to no project. */
  projectId: string | null;
  /** Deleted by the cleanup. */
  reclaimable: boolean;
}

/** Who owns what, from the database. */
interface Owners {
  video: Map<string, string>;
  job: Map<string, string>;
  clip: Map<string, string>;
  /** Archive folder / zip path → project. */
  archive: Map<string, string>;
}

const emptyBreakdown = (): StorageBreakdown => ({
  totalBytes: 0,
  reclaimableBytes: 0,
  byCategory: Object.fromEntries(STORAGE_CATEGORIES.map((c) => [c, 0])) as Record<
    StorageCategory,
    number
  >,
});

const add = (b: StorageBreakdown, f: FileEntry) => {
  b.totalBytes += f.bytes;
  b.byCategory[f.category] += f.bytes;
  if (f.reclaimable) b.reclaimableBytes += f.bytes;
};

const videoFileCategory = (name: string): StorageCategory => {
  if (name.startsWith('source.')) return 'sources';
  if (name === 'proxy.mp4' || name === 'sprite.jpg') return 'proxies';
  if (name.endsWith('.json')) return 'analysis';
  return 'other';
};

/** Disk usage by data type and project, and cleanup of large rebuildable files. */
export class StorageService {
  private cleaning = false;

  constructor(private readonly d: StorageDeps) {}

  async usage(): Promise<StorageUsage> {
    const files = await this.scan();
    const total = emptyBreakdown();
    const unassigned = emptyBreakdown();
    const perProject = new Map<string, StorageBreakdown>();
    for (const f of files) {
      add(total, f);
      if (!f.projectId) {
        add(unassigned, f);
        continue;
      }
      let b = perProject.get(f.projectId);
      if (!b) perProject.set(f.projectId, (b = emptyBreakdown()));
      add(b, f);
    }
    const names = new Map(
      this.d.db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .all()
        .map((p) => [p.id, p.name]),
    );
    const projectRows = [...perProject]
      .map(([id, b]) => ({ id, name: names.get(id) ?? id, ...b }))
      .sort((a, b) => b.totalBytes - a.totalBytes);
    return { ...total, freeBytes: await this.freeBytes(), projects: projectRows, unassigned };
  }

  /**
   * Delete encoded clips, archives and leftovers of deleted exports. Sources, proxies, frames,
   * metadata and AI responses are kept; clips can be re-encoded from the export page.
   */
  async cleanup(): Promise<StorageCleanupResult> {
    if (this.cleaning) throw conflict('A cleanup is already running');
    this.cleaning = true;
    try {
      return await this.runCleanup();
    } finally {
      this.cleaning = false;
    }
  }

  private async runCleanup(): Promise<StorageCleanupResult> {
    const result: StorageCleanupResult = {
      freedBytes: 0,
      jobsCleaned: 0,
      clipsReset: 0,
      skipped: [],
    };
    const before = await this.scan();
    const jobs = this.d.db.select().from(exportJobs).all();
    const skippedProjects = new Set<string>();
    for (const job of jobs) {
      if (job.buildStatus === 'building') {
        result.skipped.push({ projectId: job.projectId, reason: 'The archive is being built' });
        skippedProjects.add(job.projectId);
        continue;
      }
      result.clipsReset += await this.d.exports.dropEncodedFiles(job.id);
      result.jobsCleaned++;
    }
    // Leftovers: files of jobs that no longer exist, and temp files of interrupted writes.
    // A running build is still writing its .zip.part, so temp files wait for the next cleanup.
    const building = skippedProjects.size > 0;
    for (const f of before) {
      if (!f.reclaimable || f.projectId) continue;
      if (building && f.path.endsWith('.part')) continue;
      await fs.rm(f.path, { force: true });
    }
    await this.removeEmptyDirs(path.join(this.d.paths.root, 'export-work'));
    await this.removeEmptyDirs(this.d.paths.exportsRoot);

    const after = new Set((await this.scan()).map((f) => f.path));
    const freed = new Set<string>();
    for (const f of before) {
      if (f.projectId && skippedProjects.has(f.projectId)) continue;
      if (!after.has(f.path) && !freed.has(f.path)) {
        freed.add(f.path);
        result.freedBytes += f.bytes;
      }
    }
    return result;
  }

  private async freeBytes(): Promise<number | null> {
    try {
      const stats = await fs.statfs(this.d.paths.root);
      return stats.bavail * stats.bsize;
    } catch {
      return null;
    }
  }

  private owners(): Owners {
    const db = this.d.db;
    const video = new Map(
      db
        .select({ id: videos.id, projectId: videos.projectId })
        .from(videos)
        .all()
        .map((v) => [v.id, v.projectId]),
    );
    const jobs = db.select().from(exportJobs).all();
    const job = new Map(jobs.map((j) => [j.id, j.projectId]));
    const archive = new Map<string, string>();
    for (const j of jobs) {
      if (j.archiveDir) archive.set(path.resolve(j.archiveDir), j.projectId);
      if (j.archiveZip) archive.set(path.resolve(j.archiveZip), j.projectId);
    }
    const clip = new Map<string, string>();
    for (const c of db
      .select({ id: exportClips.id, jobId: exportClips.jobId })
      .from(exportClips)
      .all()) {
      const projectId = job.get(c.jobId);
      if (projectId) clip.set(c.id, projectId);
    }
    return { video, job, clip, archive };
  }

  /**
   * Every file in DATA_DIR (plus the database) with its category and owner. Hard links are
   * counted once: archives link the encoded clips, so export-work is scanned before exports and
   * a linked video counts as an encoded clip.
   */
  private async scan(): Promise<FileEntry[]> {
    const { paths } = this.d;
    const owners = this.owners();
    const seen = new Set<string>();
    const out: FileEntry[] = [];
    const known = new Set(['videos', 'export-work', 'exports', 'llm-logs', 'uploads']);

    const collect = async (
      dir: string,
      classify: (rel: string[]) => Omit<FileEntry, 'path' | 'bytes'>,
      rel: string[] = [],
    ): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          await collect(p, classify, [...rel, e.name]);
          continue;
        }
        if (!e.isFile()) continue;
        const st = await fs.lstat(p).catch(() => null);
        if (!st) continue;
        const key = `${st.dev}:${st.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path: p, bytes: st.size, ...classify([...rel, e.name]) });
      }
    };

    await collect(paths.videosRoot, ([videoId, ...rest]) => ({
      category: rest.length ? videoFileCategory(rest[rest.length - 1]!) : 'other',
      projectId: owners.video.get(videoId!) ?? null,
      reclaimable: false,
    }));

    await collect(path.join(paths.root, 'export-work'), (rel) => {
      const [jobId] = rel;
      const name = rel[rel.length - 1]!;
      const projectId = owners.job.get(jobId!) ?? null;
      if (name.startsWith('cut.')) {
        return { category: 'encodedClips', projectId, reclaimable: true };
      }
      const frame = name.startsWith('frame_');
      // Work files of a deleted job are leftovers.
      return { category: frame ? 'frames' : 'other', projectId, reclaimable: !projectId };
    });

    await collect(paths.exportsRoot, ([top]) => {
      const owner = owners.archive.get(path.resolve(paths.exportsRoot, top!)) ?? null;
      return { category: 'archives', projectId: owner, reclaimable: true };
    });

    await collect(paths.llmLogs, (rel) => {
      const clipId = rel[rel.length - 1]!.split('_')[0]!;
      return { category: 'aiLogs', projectId: owners.clip.get(clipId) ?? null, reclaimable: false };
    });

    await collect(paths.uploads, () => ({
      category: 'uploads',
      projectId: null,
      reclaimable: false,
    }));

    // projects/<id>/manifest.json and anything else at the top level.
    let top: Dirent[] = [];
    try {
      top = await fs.readdir(paths.root, { withFileTypes: true });
    } catch {
      // DATA_DIR missing: nothing stored yet.
    }
    for (const e of top) {
      if (known.has(e.name)) continue;
      const p = path.join(paths.root, e.name);
      if (e.isDirectory()) {
        await collect(p, (rel) => ({
          category: 'other',
          projectId: e.name === 'projects' ? (rel.length > 1 ? rel[0]! : null) : null,
          reclaimable: false,
        }));
      } else if (e.isFile()) {
        const st = await fs.lstat(p).catch(() => null);
        if (!st || seen.has(`${st.dev}:${st.ino}`)) continue;
        seen.add(`${st.dev}:${st.ino}`);
        out.push({
          path: p,
          bytes: st.size,
          category: 'other',
          projectId: null,
          reclaimable: false,
        });
      }
    }

    // The database may live outside DATA_DIR (a separate Docker volume).
    for (const suffix of ['', '-wal', '-shm']) {
      const p = this.d.config.dbPath + suffix;
      const st = await fs.lstat(p).catch(() => null);
      if (!st?.isFile()) continue;
      const key = `${st.dev}:${st.ino}`;
      const existing = out.find((f) => f.path === p);
      if (existing) existing.category = 'database';
      else if (!seen.has(key)) {
        seen.add(key);
        out.push({
          path: p,
          bytes: st.size,
          category: 'database',
          projectId: null,
          reclaimable: false,
        });
      }
    }

    // Temp files of interrupted writes (cut.part.*, *.zip.part) are always leftovers.
    for (const f of out) {
      if (f.path.endsWith('.part') || path.basename(f.path).startsWith('cut.part.')) {
        f.reclaimable = true;
      }
    }
    return out;
  }

  /** Remove empty directories below (not including) root. */
  private async removeEmptyDirs(root: string): Promise<void> {
    const walk = async (dir: string): Promise<boolean> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      let empty = true;
      for (const e of entries) {
        if (!e.isDirectory() || !(await walk(path.join(dir, e.name)))) empty = false;
      }
      if (empty && dir !== root) await fs.rm(dir, { recursive: true, force: true });
      return empty;
    };
    await walk(root);
  }
}
