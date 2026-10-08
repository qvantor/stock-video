import { z } from 'zod';

/** Processing pipeline: uploading → queued → probing → proxy → analyzing → ready | failed. */
export const VIDEO_STATUSES = [
  'uploading',
  'queued',
  'probing',
  'proxy',
  'analyzing',
  'ready',
  'failed',
] as const;
export const VideoStatusSchema = z.enum(VIDEO_STATUSES);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

export const SpriteMetaSchema = z.object({
  /** Seconds between consecutive thumbnails. */
  interval: z.number().positive(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  count: z.number().int().nonnegative(),
});
export type SpriteMeta = z.infer<typeof SpriteMetaSchema>;

/** Reference from a stored video to the earlier video it duplicates. */
export const DuplicateRefSchema = z.object({
  videoId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  originalFilename: z.string(),
});
export type DuplicateRef = z.infer<typeof DuplicateRefSchema>;

export const SourceVideoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  originalFilename: z.string(),
  storedPath: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  durationSec: z.number().nullable(),
  fps: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  codec: z.string().nullable(),
  proxyUrl: z.string().nullable(),
  spriteUrl: z.string().nullable(),
  spriteMeta: SpriteMetaSchema.nullable(),
  status: VideoStatusSchema,
  /** 0..1 progress of the current stage. */
  progress: z.number().min(0).max(1),
  error: z.string().nullable(),
  createdAt: z.string(),
  /** Checked by the user in the "Review segments" flow. */
  reviewed: z.boolean(),
  /** Earlier video with the same content (full hash + metadata), found after upload. */
  duplicateOf: DuplicateRefSchema.nullable(),
});
export type SourceVideo = z.infer<typeof SourceVideoSchema>;

export const SetVideoReviewedBodySchema = z.object({ reviewed: z.boolean() });
export type SetVideoReviewedBody = z.infer<typeof SetVideoReviewedBodySchema>;

export const isVideoSettled = (status: VideoStatus): boolean =>
  status === 'ready' || status === 'failed';
