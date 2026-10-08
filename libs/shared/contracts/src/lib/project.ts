import { z } from 'zod';
import { AnalysisSettingsSchema } from './settings.js';
import { SpriteMetaSchema, VideoStatusSchema } from './video.js';

export const ProjectStatusSchema = z.enum(['draft', 'confirmed']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  status: ProjectStatusSchema,
  analysisSettings: AnalysisSettingsSchema,
  /** Absolute path of manifest.json once confirmed. */
  manifestPath: z.string().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Max number of video previews returned per project in the list. */
export const PROJECT_PREVIEW_LIMIT = 4;

export const ProjectOverviewSchema = z.object({
  videoCount: z.number().int(),
  /** Number of videos per pipeline status; statuses with no videos are omitted. */
  statusCounts: z.partialRecord(VideoStatusSchema, z.number().int()),
  reviewedCount: z.number().int(),
  segmentCount: z.number().int(),
  acceptedSegments: z.number().int(),
  /** Sprite sheets of the first videos that have one (up to PROJECT_PREVIEW_LIMIT). */
  previews: z.array(
    z.object({ videoId: z.string(), spriteUrl: z.string(), spriteMeta: SpriteMetaSchema }),
  ),
});
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;

/** Item of GET /projects: the project plus an overview of its videos and segments. */
export const ProjectListItemSchema = ProjectSchema.extend({ overview: ProjectOverviewSchema });
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const CreateProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const UpdateSettingsBodySchema = AnalysisSettingsSchema;
