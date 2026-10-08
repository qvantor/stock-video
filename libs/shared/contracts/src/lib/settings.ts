import { z } from 'zod';

export const AnalysisSettingsSchema = z
  .object({
    /** Segments shorter than this (seconds) are dropped / flagged. */
    minDuration: z.number().min(1).max(600),
    /** Segments longer than this (seconds) are split / flagged. */
    maxDuration: z.number().min(2).max(1200),
    /** Preferred length when splitting long runs. */
    targetDuration: z.number().min(1).max(1200),
    /** Frame rate used for motion analysis (frames per second). */
    analysisFps: z.number().min(1).max(30),
    /** Threshold multiplier: >1 = more sensitive (more boundaries, stricter "smooth"), <1 = more tolerant. */
    sensitivity: z.number().min(0.25).max(4),
    /** Keep hovering (static) shots. */
    includeStatic: z.boolean(),
  })
  .refine((s) => s.minDuration < s.maxDuration, {
    message: 'minDuration must be less than maxDuration',
    path: ['maxDuration'],
  })
  .refine((s) => s.targetDuration >= s.minDuration && s.targetDuration <= s.maxDuration, {
    message: 'targetDuration must be within [minDuration, maxDuration]',
    path: ['targetDuration'],
  });

export type AnalysisSettings = z.infer<typeof AnalysisSettingsSchema>;

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  minDuration: 7,
  maxDuration: 40,
  targetDuration: 25,
  analysisFps: 5,
  sensitivity: 1.5,
  includeStatic: false,
};

export const ReanalyzeBodySchema = z.object({
  /** Parameters for this run; defaults to the project's settings. */
  settings: AnalysisSettingsSchema.optional(),
});
export type ReanalyzeBody = z.infer<typeof ReanalyzeBodySchema>;
