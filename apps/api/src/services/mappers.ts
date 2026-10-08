import type { DuplicateRef, Project, Segment, SourceVideo } from '@dfs/contracts';
import type { ProjectRow, SegmentRow, VideoRow } from '../db/schema.js';
import { mediaUrl } from '../lib/paths.js';

export const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  status: row.status,
  analysisSettings: row.analysisSettings,
  manifestPath: row.manifestPath,
});

export const toVideo = (row: VideoRow, duplicateOf: DuplicateRef | null = null): SourceVideo => ({
  id: row.id,
  projectId: row.projectId,
  originalFilename: row.originalFilename,
  storedPath: row.storedPath,
  sizeBytes: row.sizeBytes,
  durationSec: row.durationSec,
  fps: row.fps,
  width: row.width,
  height: row.height,
  codec: row.codec,
  proxyUrl: row.hasProxy ? mediaUrl(row.id, 'proxy.mp4') : null,
  spriteUrl: row.spriteMeta ? mediaUrl(row.id, 'sprite.jpg') : null,
  spriteMeta: row.spriteMeta,
  status: row.status,
  progress: row.progress,
  error: row.error,
  createdAt: row.createdAt,
  reviewed: row.reviewed,
  duplicateOf,
});

export const toSegment = (row: SegmentRow): Segment => ({
  id: row.id,
  videoId: row.videoId,
  startSec: row.startSec,
  endSec: row.endSec,
  motionType: row.motionType,
  score: row.score,
  reasons: row.reasons,
  origin: row.origin,
  accepted: row.accepted,
  edited: row.edited,
});
