import { z } from 'zod';
import { MotionTypeSchema } from './motion.js';

/** Per-clip pipeline: queued → frames → geo → tech → llm → review → cut → done | failed. */
export const CLIP_STATUSES = [
  'queued',
  'frames',
  'geo',
  'tech',
  'llm',
  'review',
  'cut',
  'done',
  'failed',
] as const;
export const ClipStatusSchema = z.enum(CLIP_STATUSES);
export type ClipStatus = z.infer<typeof ClipStatusSchema>;

export const CLIP_STEPS = ['frames', 'geo', 'tech', 'llm', 'cut'] as const;
export const ClipStepSchema = z.enum(CLIP_STEPS);
export type ClipStep = z.infer<typeof ClipStepSchema>;

export const ClipFrameSchema = z.object({
  index: z.number().int().nonnegative(),
  /** Time in the source video. */
  timeSec: z.number().nonnegative(),
  /** Laplacian variance from stage-1 analysis, if available. */
  sharpness: z.number().nullable(),
  /** Public URL of the full-size preview JPEG. */
  url: z.string(),
});
export type ClipFrame = z.infer<typeof ClipFrameSchema>;

export const PoiCandidateSchema = z.object({
  name: z.string(),
  nameEn: z.string(),
  type: z.string(),
  distanceM: z.number().nonnegative(),
  bearingDeg: z.number().min(0).max(360),
  /** null when the camera heading is unknown. */
  inCameraSector: z.boolean().nullable(),
  wikidataId: z.string().nullable(),
});
export type PoiCandidate = z.infer<typeof PoiCandidateSchema>;

export const LOCATION_SOURCES = ['embedded', 'manual', 'none'] as const;

export const GeoContextSchema = z.object({
  source: z.enum(LOCATION_SOURCES),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  altitudeM: z.number().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  displayName: z.string().nullable(),
  /** Name in the local language (e.g. Cyrillic), kept apart from the English one. */
  localName: z.string().nullable(),
  /** Free text from the manual location field when it could not be geocoded. */
  manualText: z.string().nullable(),
  /** Estimated camera heading (degrees from north), from the flight direction in the telemetry. */
  cameraHeadingDeg: z.number().nullable(),
  poiCandidates: z.array(PoiCandidateSchema),
});
export type GeoContext = z.infer<typeof GeoContextSchema>;

export const SHOT_TYPES = [
  'real_time',
  'slow_motion',
  'high_frame_rate',
  'timelapse',
  'hyperlapse',
] as const;
export const ShotTypeSchema = z.enum(SHOT_TYPES);
export type ShotType = z.infer<typeof ShotTypeSchema>;

export const TIMES_OF_DAY = [
  'sunrise',
  'golden_hour',
  'day',
  'sunset',
  'blue_hour',
  'night',
] as const;
export const TimeOfDaySchema = z.enum(TIMES_OF_DAY);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export const SeasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof SeasonSchema>;

export const TechContextSchema = z.object({
  /** Duration of the delivered clip (longer than the source span when conformed to slow motion). */
  durationSec: z.number().positive(),
  sourceDurationSec: z.number().positive(),
  fps: z.number().positive(),
  outputFps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  resolutionLabel: z.string(),
  codec: z.string(),
  bitDepth: z.number().int(),
  colorTransfer: z.enum(['rec709', 'hlg', 'pq', 'log', 'unknown']),
  hasAudio: z.boolean(),
  shotType: ShotTypeSchema,
  motionType: MotionTypeSchema,
  /** Envato "Movement" values. */
  movement: z.array(z.string()),
  timeOfDay: TimeOfDaySchema.nullable(),
  season: SeasonSchema.nullable(),
  /** Capture instant (UTC ISO) if known. */
  capturedAt: z.string().nullable(),
  /** Local calendar date of capture, yyyy-mm-dd. */
  captureDate: z.string().nullable(),
  altitudeM: z.number().nullable(),
  droneModel: z.string().nullable(),
});
export type TechContext = z.infer<typeof TechContextSchema>;

export const ClipContextSchema = z.object({
  frames: z.array(ClipFrameSchema).nullable(),
  geo: GeoContextSchema.nullable(),
  tech: TechContextSchema.nullable(),
});
export type ClipContext = z.infer<typeof ClipContextSchema>;

export const PLACE_CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;

/** Metadata as returned by the model (category values are validated against platform lists in stage 2). */
export const ClipMetadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)),
  subject: z.string().min(1),
  placeConfidence: z.enum(PLACE_CONFIDENCE),
  adobeCategory: z.number().int(),
  shutterstockCategories: z.array(z.string()).min(1).max(2),
  envatoCategory: z.string(),
  recognizableBuildings: z.boolean(),
  editorialSuggested: z.boolean(),
  editorialReason: z.string().nullable(),
});
export type ClipMetadata = z.infer<typeof ClipMetadataSchema>;

/** Manual edits from the UI. `editorial` is the user's final decision (defaults to the model's suggestion). */
export const ClipMetadataPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000),
    keywords: z.array(z.string().trim().min(1).max(100)).max(100),
    subject: z.string().trim().min(1).max(100),
    adobeCategory: z.number().int(),
    shutterstockCategories: z.array(z.string()).min(1).max(2),
    envatoCategory: z.string(),
    recognizableBuildings: z.boolean(),
    editorial: z.boolean(),
  })
  .partial();
export type ClipMetadataPatch = z.infer<typeof ClipMetadataPatchSchema>;

export const ValidationLevelSchema = z.enum(['ok', 'warning', 'error']);
export type ValidationLevel = z.infer<typeof ValidationLevelSchema>;

export const PlatformValidationSchema = z.object({
  platform: z.string(),
  level: ValidationLevelSchema,
  messages: z.array(z.string()),
});
export type PlatformValidation = z.infer<typeof PlatformValidationSchema>;

export const GenerationInfoSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  attempts: z.number().int().positive(),
  generatedAt: z.string(),
  /** Raw (pre-post-processing) model answer. */
  raw: ClipMetadataSchema,
});
export type GenerationInfo = z.infer<typeof GenerationInfoSchema>;

export const ExportClipSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  videoId: z.string(),
  segmentId: z.string(),
  ordinal: z.number().int().nonnegative(),
  originalFilename: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  motionType: MotionTypeSchema,
  status: ClipStatusSchema,
  /** 0..1 within the current step. */
  progress: z.number().min(0).max(1),
  failedStep: ClipStepSchema.nullable(),
  error: z.string().nullable(),
  excluded: z.boolean(),
  approved: z.boolean(),
  context: ClipContextSchema,
  metadata: ClipMetadataSchema.nullable(),
  /** Final editorial flag (user decision, defaults to the model suggestion). */
  editorial: z.boolean(),
  generation: GenerationInfoSchema.nullable(),
  userHint: z.string().nullable(),
  poiOverride: z.string().nullable(),
  /** Final delivery filename (with extension), identical in every CSV. */
  filename: z.string().nullable(),
  outputSizeBytes: z.number().int().nullable(),
  validations: z.array(PlatformValidationSchema),
  updatedAt: z.string(),
});
export type ExportClip = z.infer<typeof ExportClipSchema>;
