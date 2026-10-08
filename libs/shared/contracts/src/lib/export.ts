import { z } from 'zod';
import { CLIP_STATUSES, ClipStatusSchema, ExportClipSchema } from './clip.js';

export const BUILD_STATUSES = ['idle', 'building', 'built', 'failed'] as const;

export const ExportArchiveSchema = z.object({
  builtAt: z.string(),
  /** Export folder as seen on the host. */
  folderPath: z.string(),
  zipUrl: z.string(),
  zipSizeBytes: z.number().int().nonnegative(),
  reportMd: z.string(),
  clipCount: z.number().int().nonnegative(),
});
export type ExportArchive = z.infer<typeof ExportArchiveSchema>;

export const ExportJobSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  createdAt: z.string(),
  total: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  counts: z.record(ClipStatusSchema, z.number().int().nonnegative()),
  /** 0..1 over all non-excluded clips. */
  progress: z.number().min(0).max(1),
  /** Every non-excluded clip is done and at least one exists. */
  canBuild: z.boolean(),
  buildStatus: z.enum(BUILD_STATUSES),
  buildError: z.string().nullable(),
  archive: ExportArchiveSchema.nullable(),
});
export type ExportJob = z.infer<typeof ExportJobSchema>;

export const emptyStatusCounts = (): Record<(typeof CLIP_STATUSES)[number], number> =>
  Object.fromEntries(CLIP_STATUSES.map((s) => [s, 0])) as Record<
    (typeof CLIP_STATUSES)[number],
    number
  >;

export const ExportVideoSchema = z.object({
  id: z.string(),
  originalFilename: z.string(),
  manualLocation: z.string().nullable(),
  embeddedLocation: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  creationTime: z.string().nullable(),
  droneModel: z.string().nullable(),
});
export type ExportVideo = z.infer<typeof ExportVideoSchema>;

export const ExportStateSchema = z.object({
  job: ExportJobSchema,
  clips: z.array(ExportClipSchema),
  videos: z.array(ExportVideoSchema),
});
export type ExportState = z.infer<typeof ExportStateSchema>;

export const RegenerateBodySchema = z.object({
  /** Free-form hint for the model, e.g. "this is Kazan Cathedral". */
  hint: z.string().trim().max(500).optional(),
  /** Name of the POI candidate the user picked as the subject. */
  poiName: z.string().trim().max(300).optional(),
});
export type RegenerateBody = z.infer<typeof RegenerateBodySchema>;

export const VideoLocationBodySchema = z.object({
  /** "City, landmark, country" or "lat, lon"; empty / null clears it. */
  location: z.string().trim().max(300).nullable(),
});
export type VideoLocationBody = z.infer<typeof VideoLocationBodySchema>;

export const ClipIdsBodySchema = z.object({ clipIds: z.array(z.string()).min(1) });
export type ClipIdsBody = z.infer<typeof ClipIdsBodySchema>;

export const ExcludeBodySchema = z.object({ excluded: z.boolean() });

export const BulkKeywordsBodySchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    clipIds: z.array(z.string()).min(1),
    keyword: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('remove'),
    clipIds: z.array(z.string()).min(1),
    keyword: z.string().trim().min(1),
  }),
  z.object({
    op: z.literal('replace'),
    clipIds: z.array(z.string()).min(1),
    find: z.string().trim().min(1),
    replace: z.string().trim(),
  }),
]);
export type BulkKeywordsBody = z.infer<typeof BulkKeywordsBodySchema>;

export const OllamaHealthSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  model: z.string(),
  message: z.string().nullable(),
});
export type OllamaHealth = z.infer<typeof OllamaHealthSchema>;

export const StockPlatformInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  lastVerified: z.string(),
  verified: z.boolean(),
});
export type StockPlatformInfo = z.infer<typeof StockPlatformInfoSchema>;

export const StockCategoriesSchema = z.object({
  adobe: z.array(z.object({ id: z.number().int(), label: z.string() })),
  shutterstock: z.array(z.string()),
  envato: z.array(z.string()),
});
export type StockCategories = z.infer<typeof StockCategoriesSchema>;
