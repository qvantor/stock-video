import { z } from 'zod';
import { ClipStatusSchema, ExportClipSchema } from './clip.js';
import { ExportJobSchema } from './export.js';
import { ProjectSchema } from './project.js';
import { SourceVideoSchema, VideoStatusSchema } from './video.js';

export const ProjectEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video.progress'),
    videoId: z.string(),
    status: VideoStatusSchema,
    progress: z.number(),
  }),
  z.object({ type: z.literal('video.updated'), video: SourceVideoSchema }),
  z.object({ type: z.literal('video.deleted'), videoId: z.string() }),
  z.object({ type: z.literal('segments.updated'), videoId: z.string() }),
  z.object({ type: z.literal('project.updated'), project: ProjectSchema }),
  z.object({ type: z.literal('project.deleted'), projectId: z.string() }),
  z.object({ type: z.literal('export.updated'), job: ExportJobSchema }),
  /** The export job and its clips were discarded (reopen / regenerate all). */
  z.object({ type: z.literal('export.reset'), projectId: z.string() }),
  z.object({ type: z.literal('export.clip.updated'), clip: ExportClipSchema }),
  z.object({
    type: z.literal('export.clip.progress'),
    clipId: z.string(),
    status: ClipStatusSchema,
    progress: z.number(),
  }),
]);
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
