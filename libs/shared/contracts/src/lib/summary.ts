import { z } from 'zod';

export const ProjectSummarySchema = z.object({
  videoCount: z.number().int(),
  readyCount: z.number().int(),
  failedCount: z.number().int(),
  processingCount: z.number().int(),
  proposedSegments: z.number().int(),
  acceptedSegments: z.number().int(),
  acceptedDurationSec: z.number(),
  /** Validation problems among accepted segments (block confirmation). */
  issueCount: z.number().int(),
  canConfirm: z.boolean(),
  /** Human-readable reasons why confirmation is not possible yet. */
  blockers: z.array(z.string()),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
