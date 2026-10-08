import { z } from 'zod';

/** One dependency the app needs (DB, storage, ffmpeg, Ollama, geocoder). */
export const SystemCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  /** Actionable error when not ok, or a short detail. */
  message: z.string().nullable(),
});
export type SystemCheck = z.infer<typeof SystemCheckSchema>;

export const SystemStatusSchema = z.object({
  checks: z.array(SystemCheckSchema),
});
export type SystemStatus = z.infer<typeof SystemStatusSchema>;
