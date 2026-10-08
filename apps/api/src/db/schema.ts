import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  AnalysisSettings,
  ClipFrame,
  ClipMetadata,
  ClipStatus,
  ClipStep,
  ExportArchive,
  GenerationInfo,
  GeoContext,
  MotionType,
  SpriteMeta,
  TechContext,
  VideoStatus,
} from '@dfs/contracts';
import type { MediaInfo } from '@dfs/ffmpeg';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  status: text('status', { enum: ['draft', 'confirmed'] })
    .notNull()
    .default('draft'),
  analysisSettings: text('analysis_settings', { mode: 'json' }).$type<AnalysisSettings>().notNull(),
  manifestPath: text('manifest_path'),
});

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** tus upload id while uploading; used to find the video from tus hooks. */
    uploadId: text('upload_id'),
    originalFilename: text('original_filename').notNull(),
    storedPath: text('stored_path'),
    sizeBytes: integer('size_bytes').notNull(),
    durationSec: real('duration_sec'),
    fps: real('fps'),
    width: integer('width'),
    height: integer('height'),
    codec: text('codec'),
    hasProxy: integer('has_proxy', { mode: 'boolean' }).notNull().default(false),
    spriteMeta: text('sprite_meta', { mode: 'json' }).$type<SpriteMeta>(),
    status: text('status').$type<VideoStatus>().notNull(),
    progress: real('progress').notNull().default(0),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    /** Full ffprobe info (GPS, creation time, camera, colour) — read lazily by stage 2. */
    mediaInfo: text('media_info', { mode: 'json' }).$type<MediaInfo>(),
    /** Location typed by the user when the file has no GPS ("city, landmark" or "lat, lon"). */
    manualLocation: text('manual_location'),
    /** Checked by the user in the "Review segments" flow. */
    reviewed: integer('reviewed', { mode: 'boolean' }).notNull().default(false),
    /** sha256 of the size + first/last bytes of the file (see `fingerprintRanges`). */
    fingerprint: text('fingerprint'),
    /** sha256 of the whole source file. */
    contentHash: text('content_hash'),
    /** Earlier video with the same content and metadata. */
    duplicateOfId: text('duplicate_of_id').references((): AnySQLiteColumn => videos.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('videos_project_idx').on(t.projectId),
    index('videos_upload_idx').on(t.uploadId),
    index('videos_fingerprint_idx').on(t.sizeBytes, t.fingerprint),
    index('videos_hash_idx').on(t.contentHash),
  ],
);

export const segments = sqliteTable(
  'segments',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    startSec: real('start_sec').notNull(),
    endSec: real('end_sec').notNull(),
    motionType: text('motion_type').$type<MotionType>().notNull(),
    score: real('score').notNull(),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull(),
    origin: text('origin', { enum: ['ai', 'user'] }).notNull(),
    accepted: integer('accepted', { mode: 'boolean' }).notNull(),
    edited: integer('edited', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('segments_video_idx').on(t.videoId)],
);

export const exportJobs = sqliteTable(
  'export_jobs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    manifestPath: text('manifest_path').notNull(),
    createdAt: text('created_at').notNull(),
    buildStatus: text('build_status', { enum: ['idle', 'building', 'built', 'failed'] })
      .notNull()
      .default('idle'),
    buildError: text('build_error'),
    archive: text('archive', { mode: 'json' }).$type<ExportArchive>(),
    /** Absolute paths of the last built export folder and zip (inside DATA_DIR). */
    archiveDir: text('archive_dir'),
    archiveZip: text('archive_zip'),
    /** Hash of everything that went into the last archive; equal hash → no rebuild. */
    archiveHash: text('archive_hash'),
  },
  (t) => [index('export_jobs_project_idx').on(t.projectId)],
);

export type StepHashes = Partial<Record<ClipStep, string>>;

export const exportClips = sqliteTable(
  'export_clips',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => exportJobs.id, { onDelete: 'cascade' }),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    segmentId: text('segment_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    startSec: real('start_sec').notNull(),
    endSec: real('end_sec').notNull(),
    startFrame: integer('start_frame').notNull(),
    endFrame: integer('end_frame').notNull(),
    motionType: text('motion_type').$type<MotionType>().notNull(),
    status: text('status').$type<ClipStatus>().notNull(),
    progress: real('progress').notNull().default(0),
    failedStep: text('failed_step').$type<ClipStep>(),
    error: text('error'),
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
    approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
    frames: text('frames', { mode: 'json' }).$type<ClipFrame[]>(),
    geo: text('geo', { mode: 'json' }).$type<GeoContext>(),
    tech: text('tech', { mode: 'json' }).$type<TechContext>(),
    generation: text('generation', { mode: 'json' }).$type<GenerationInfo>(),
    /** Final (post-processed and user-edited) metadata. */
    metadata: text('metadata', { mode: 'json' }).$type<ClipMetadata>(),
    /** User's editorial decision; null = follow the model suggestion. */
    editorial: integer('editorial', { mode: 'boolean' }),
    userHint: text('user_hint'),
    poiOverride: text('poi_override'),
    stepHashes: text('step_hashes', { mode: 'json' }).$type<StepHashes>().notNull(),
    cutPath: text('cut_path'),
    outputSizeBytes: integer('output_size_bytes'),
    filename: text('filename'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('export_clips_job_idx').on(t.jobId), index('export_clips_status_idx').on(t.status)],
);

/** Coordinates/query → Nominatim or POI response; rounded keys make nearby clips share entries. */
export const geoCache = sqliteTable('geo_cache', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  fetchedAt: text('fetched_at').notNull(),
});

/** Global key/value settings (e.g. `export`). */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
export type VideoRow = typeof videos.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;
export type ExportJobRow = typeof exportJobs.$inferSelect;
export type ExportClipRow = typeof exportClips.$inferSelect;
