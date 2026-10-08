import { z } from 'zod';
import { VideoStatusSchema } from './video.js';

/** Bytes hashed from the start and from the end of a file for its quick fingerprint. */
export const FINGERPRINT_CHUNK = 8 * 1024 * 1024;

/** Durations closer than this (seconds) are treated as equal when matching duplicates. */
export const DUPLICATE_DURATION_TOLERANCE = 0.05;

/**
 * Byte layout of a file fingerprint: sha256 over `"<size>\n"`, then the first
 * FINGERPRINT_CHUNK bytes, then the last FINGERPRINT_CHUNK bytes (without overlap).
 * MP4/MOV keep their `moov` atom (duration, sample tables, creation time) at one of
 * the ends, so this covers container metadata as well as content.
 * The browser and the API must hash exactly these ranges.
 */
export const fingerprintRanges = (size: number): Array<[start: number, end: number]> => {
  const head: [number, number] = [0, Math.min(FINGERPRINT_CHUNK, size)];
  const tailStart = Math.max(head[1], size - FINGERPRINT_CHUNK);
  return tailStart < size ? [head, [tailStart, size]] : [head];
};

export const fingerprintPrefix = (size: number): string => `${size}\n`;

/** An already stored video that a new upload duplicates. */
export const ExistingVideoInfoSchema = z.object({
  videoId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  originalFilename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationSec: z.number().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  codec: z.string().nullable(),
  /** Recording time from the container metadata, if known. */
  creationTime: z.string().nullable(),
  /** Upload time. */
  createdAt: z.string(),
  status: VideoStatusSchema,
});
export type ExistingVideoInfo = z.infer<typeof ExistingVideoInfoSchema>;

export const DuplicateCheckFileSchema = z.object({
  /** Client-side id echoed back in the response. */
  key: z.string(),
  filename: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** Duration read by the browser; omitted when it could not be read. */
  durationSec: z.number().positive().optional(),
});
export type DuplicateCheckFile = z.infer<typeof DuplicateCheckFileSchema>;

export const DuplicateCheckRequestSchema = z.object({
  files: z.array(DuplicateCheckFileSchema).max(500),
});
export type DuplicateCheckRequest = z.infer<typeof DuplicateCheckRequestSchema>;

export const DuplicateCheckResponseSchema = z.object({
  /** Existing videos per request key; keys without a match are left out. */
  matches: z.record(z.string(), z.array(ExistingVideoInfoSchema)),
});
export type DuplicateCheckResponse = z.infer<typeof DuplicateCheckResponseSchema>;
