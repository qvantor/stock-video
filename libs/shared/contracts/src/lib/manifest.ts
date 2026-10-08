import { z } from 'zod';
import { AnalysisSettingsSchema } from './settings.js';
import { MotionTypeSchema } from './motion.js';
import { SegmentOriginSchema } from './segment.js';

export const ManifestSegmentSchema = z.object({
  segmentId: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  motionType: MotionTypeSchema,
  score: z.number().min(0).max(1),
  origin: SegmentOriginSchema,
});
export type ManifestSegment = z.infer<typeof ManifestSegmentSchema>;

export const ManifestVideoSchema = z.object({
  videoId: z.string(),
  originalFilename: z.string(),
  sourcePath: z.string(),
  durationSec: z.number().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Reserved for stage 2; not populated in stage 1. */
  telemetryPath: z.string().optional(),
  segments: z.array(ManifestSegmentSchema),
});
export type ManifestVideo = z.infer<typeof ManifestVideoSchema>;

/** Hand-off contract between stage 1 (segmentation) and stage 2 (cutting / metadata). */
export const SegmentationManifestSchema = z.object({
  manifestVersion: z.literal(1),
  projectId: z.string(),
  confirmedAt: z.string(),
  settings: AnalysisSettingsSchema,
  videos: z.array(ManifestVideoSchema),
});
export type SegmentationManifest = z.infer<typeof SegmentationManifestSchema>;

export const ConfirmResponseSchema = z.object({
  manifestPath: z.string(),
  manifest: SegmentationManifestSchema,
});
export type ConfirmResponse = z.infer<typeof ConfirmResponseSchema>;
