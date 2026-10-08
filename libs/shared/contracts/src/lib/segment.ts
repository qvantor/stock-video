import { z } from 'zod';
import { MotionTypeSchema } from './motion.js';

export const SegmentOriginSchema = z.enum(['ai', 'user']);
export type SegmentOrigin = z.infer<typeof SegmentOriginSchema>;

export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    videoId: z.string(),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
    motionType: MotionTypeSchema,
    score: z.number().min(0).max(1),
    reasons: z.array(z.string()),
    origin: SegmentOriginSchema,
    accepted: z.boolean(),
    edited: z.boolean(),
  })
  .refine((s) => s.endSec > s.startSec, {
    message: 'endSec must be greater than startSec',
  });
export type Segment = z.infer<typeof SegmentSchema>;

export const PutSegmentsBodySchema = z.object({
  segments: z.array(SegmentSchema),
});
export type PutSegmentsBody = z.infer<typeof PutSegmentsBodySchema>;
