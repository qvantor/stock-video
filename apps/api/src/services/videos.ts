import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  DUPLICATE_DURATION_TOLERANCE,
  type DuplicateCheckFile,
  type DuplicateRef,
  type ExistingVideoInfo,
  type SourceVideo,
  type VideoStatus,
} from '@dfs/contracts';
import type { Db } from '../db/client.js';
import { projects, videos, type ProjectRow, type VideoRow } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import type { DataPaths } from '../lib/paths.js';
import type { EventBus } from './event-bus.js';
import { toVideo } from './mappers.js';

export type VideoPatch = Partial<Omit<VideoRow, 'id' | 'projectId' | 'createdAt'>>;

/** Minimum progress delta between two persisted/broadcast progress updates. */
const PROGRESS_STEP = 0.01;
/** Frame rates closer than this are treated as equal when matching duplicates. */
const FPS_TOLERANCE = 0.01;

const near = (a: number | null, b: number | null, tolerance: number): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) <= tolerance;

/** Same content (full hash) and the same probed metadata. */
const isSameVideo = (a: VideoRow, b: VideoRow): boolean =>
  a.contentHash !== null &&
  a.contentHash === b.contentHash &&
  a.sizeBytes === b.sizeBytes &&
  near(a.durationSec, b.durationSec, DUPLICATE_DURATION_TOLERANCE) &&
  near(a.fps, b.fps, FPS_TOLERANCE) &&
  a.width === b.width &&
  a.height === b.height &&
  a.codec === b.codec &&
  (a.mediaInfo?.creationTime ?? null) === (b.mediaInfo?.creationTime ?? null);

const toExistingInfo = (v: VideoRow, p: ProjectRow): ExistingVideoInfo => ({
  videoId: v.id,
  projectId: p.id,
  projectName: p.name,
  originalFilename: v.originalFilename,
  sizeBytes: v.sizeBytes,
  durationSec: v.durationSec,
  width: v.width,
  height: v.height,
  fps: v.fps,
  codec: v.codec,
  creationTime: v.mediaInfo?.creationTime ?? null,
  createdAt: v.createdAt,
  status: v.status,
});

export class VideoService {
  private readonly lastProgress = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly paths: DataPaths,
  ) {}

  createUploading(input: {
    projectId: string;
    uploadId: string;
    originalFilename: string;
    sizeBytes: number;
    /** Client-computed; replaced by the server-computed value during processing. */
    fingerprint?: string | null;
  }): SourceVideo {
    const row = this.db
      .insert(videos)
      .values({
        id: randomUUID(),
        projectId: input.projectId,
        uploadId: input.uploadId,
        originalFilename: input.originalFilename,
        sizeBytes: input.sizeBytes,
        fingerprint: input.fingerprint ?? null,
        status: 'uploading',
        progress: 0,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    const video = this.dto(row);
    this.bus.publish(video.projectId, { type: 'video.updated', video });
    return video;
  }

  private dto(row: VideoRow): SourceVideo {
    return toVideo(row, row.duplicateOfId ? this.duplicateRef(row.duplicateOfId) : null);
  }

  private duplicateRef(videoId: string): DuplicateRef | null {
    const found = this.db
      .select({ video: videos, project: projects })
      .from(videos)
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(eq(videos.id, videoId))
      .get();
    return found
      ? {
          videoId: found.video.id,
          projectId: found.project.id,
          projectName: found.project.name,
          originalFilename: found.video.originalFilename,
        }
      : null;
  }

  /**
   * Stored videos (in any project) matching a file about to be uploaded:
   * same size and fingerprint, and the same duration when the browser could read it.
   */
  findUploadDuplicates(file: DuplicateCheckFile): ExistingVideoInfo[] {
    return this.db
      .select({ video: videos, project: projects })
      .from(videos)
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(
        and(
          eq(videos.sizeBytes, file.sizeBytes),
          eq(videos.fingerprint, file.fingerprint),
          ne(videos.status, 'uploading'),
        ),
      )
      .orderBy(asc(videos.createdAt))
      .all()
      .filter(
        ({ video }) =>
          file.durationSec === undefined ||
          video.durationSec === null ||
          Math.abs(video.durationSec - file.durationSec) <= DUPLICATE_DURATION_TOLERANCE,
      )
      .map(({ video, project }) => toExistingInfo(video, project));
  }

  /** The earliest uploaded video with the same content hash and metadata, if any. */
  findEarlierDuplicate(row: VideoRow): VideoRow | undefined {
    if (!row.contentHash) return undefined;
    return this.db
      .select()
      .from(videos)
      .where(and(eq(videos.contentHash, row.contentHash), ne(videos.id, row.id)))
      .orderBy(asc(videos.createdAt), asc(videos.id))
      .all()
      .find(
        (other) =>
          (other.createdAt < row.createdAt ||
            (other.createdAt === row.createdAt && other.id < row.id)) &&
          isSameVideo(row, other),
      );
  }

  /** Settled videos whose fingerprint or content hash has not been computed yet. */
  listMissingHashes(): VideoRow[] {
    return this.listByStatus(['ready', 'failed']).filter(
      (row) => row.storedPath && (!row.fingerprint || !row.contentHash),
    );
  }

  findRow(id: string): VideoRow | undefined {
    return this.db.select().from(videos).where(eq(videos.id, id)).get();
  }

  getRow(id: string): VideoRow {
    const row = this.findRow(id);
    if (!row) throw notFound('Video');
    return row;
  }

  get(id: string): SourceVideo {
    return this.dto(this.getRow(id));
  }

  findByUploadId(uploadId: string): VideoRow | undefined {
    return this.db.select().from(videos).where(eq(videos.uploadId, uploadId)).get();
  }

  listByProject(projectId: string): SourceVideo[] {
    return this.db
      .select()
      .from(videos)
      .where(eq(videos.projectId, projectId))
      .orderBy(asc(videos.createdAt))
      .all()
      .map((row) => this.dto(row));
  }

  listByStatus(statuses: VideoStatus[]): VideoRow[] {
    return this.db.select().from(videos).where(inArray(videos.status, statuses)).all();
  }

  update(id: string, patch: VideoPatch): SourceVideo {
    const row = this.db.update(videos).set(patch).where(eq(videos.id, id)).returning().get();
    if (!row) throw notFound('Video');
    const video = this.dto(row);
    this.lastProgress.set(id, video.progress);
    this.bus.publish(video.projectId, { type: 'video.updated', video });
    return video;
  }

  /** Throttled progress update: persisted and broadcast only on visible change. */
  setProgress(id: string, status: VideoStatus, progress: number): void {
    const prev = this.lastProgress.get(id) ?? -1;
    const value = Math.max(0, Math.min(1, progress));
    if (Math.abs(value - prev) < PROGRESS_STEP && value !== 1) return;
    this.lastProgress.set(id, value);
    const row = this.db
      .update(videos)
      .set({ status, progress: value })
      .where(and(eq(videos.id, id), eq(videos.status, status)))
      .returning({ projectId: videos.projectId })
      .get();
    if (row)
      this.bus.publish(row.projectId, {
        type: 'video.progress',
        videoId: id,
        status,
        progress: value,
      });
  }

  async remove(id: string): Promise<void> {
    const row = this.getRow(id);
    this.db.delete(videos).where(eq(videos.id, id)).run();
    this.lastProgress.delete(id);
    await fs.rm(this.paths.videoDir(id), { recursive: true, force: true });
    this.bus.publish(row.projectId, { type: 'video.deleted', videoId: id });
  }
}
