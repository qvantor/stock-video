import { z } from 'zod';
import { MotionTypeSchema } from './motion.js';

/**
 * Per-sample motion metrics (one sample per analysed frame pair) for the
 * timeline graph. Stored column-wise to keep the payload compact.
 */
export const VideoMetricsSchema = z.object({
  /** Sample rate (= analysisFps). Sample i is at time t[i]. */
  fps: z.number().positive(),
  t: z.array(z.number()),
  /** Normalised motion speed 0..1. */
  speed: z.array(z.number()),
  /** Flow coherence / smoothness 0..1. */
  smoothness: z.array(z.number()),
  /** Smoothed per-sample motion class. */
  motion: z.array(MotionTypeSchema),
});
export type VideoMetrics = z.infer<typeof VideoMetricsSchema>;
