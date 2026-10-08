import { z } from 'zod';

/** Kinds of data kept in DATA_DIR (and the database). */
export const StorageCategorySchema = z.enum([
  'sources',
  'proxies',
  'analysis',
  'encodedClips',
  'archives',
  'frames',
  'aiLogs',
  'uploads',
  'database',
  'other',
]);
export type StorageCategory = z.infer<typeof StorageCategorySchema>;

export const STORAGE_CATEGORIES = StorageCategorySchema.options;

/** Bytes per category; a category without data is reported as 0. */
export const StorageBreakdownSchema = z.object({
  totalBytes: z.number(),
  /** Bytes the cleanup would free (encoded clips, archives, leftovers). */
  reclaimableBytes: z.number(),
  byCategory: z.record(StorageCategorySchema, z.number()),
});
export type StorageBreakdown = z.infer<typeof StorageBreakdownSchema>;

export const ProjectStorageSchema = StorageBreakdownSchema.extend({
  id: z.string(),
  name: z.string(),
});
export type ProjectStorage = z.infer<typeof ProjectStorageSchema>;

export const StorageUsageSchema = StorageBreakdownSchema.extend({
  /** Free space on the disk holding DATA_DIR; null when it cannot be determined. */
  freeBytes: z.number().nullable(),
  /** Largest first. */
  projects: z.array(ProjectStorageSchema),
  /** Files that belong to no existing project (leftovers, the database). */
  unassigned: StorageBreakdownSchema,
});
export type StorageUsage = z.infer<typeof StorageUsageSchema>;

export const StorageCleanupResultSchema = z.object({
  freedBytes: z.number(),
  jobsCleaned: z.number(),
  /** Clips moved back to "approved · waiting for encoding". */
  clipsReset: z.number(),
  skipped: z.array(z.object({ projectId: z.string(), reason: z.string() })),
});
export type StorageCleanupResult = z.infer<typeof StorageCleanupResultSchema>;
