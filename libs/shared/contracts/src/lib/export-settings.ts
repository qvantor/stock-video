import { z } from 'zod';

export const ENCODING_CODECS = ['h264', 'prores_hq'] as const;
export const CONTAINERS = ['mov', 'mp4'] as const;
/** Conform high-frame-rate footage (≥100 fps) to a playback rate, producing slow motion. */
export const SLOW_MO_CONFORM = ['off', '25', '30'] as const;
/**
 * How to interpret `creation_time` from the container.
 * `auto`: DJI writes local wall-clock time labelled as UTC — treat it as local for DJI, UTC otherwise.
 */
export const CREATION_TIME_MODES = ['auto', 'utc', 'local'] as const;
export type SlowMoConform = (typeof SLOW_MO_CONFORM)[number];
export type CreationTimeMode = (typeof CREATION_TIME_MODES)[number];

export const EncodingSettingsSchema = z.object({
  codec: z.enum(ENCODING_CODECS).default('h264'),
  /** x264 constant rate factor (lower = better). */
  crf: z.number().int().min(0).max(51).default(16),
  /** Upper bound for the H.264 bitrate at 4K; scaled down by pixel count for smaller frames. */
  maxBitrateMbps: z.number().int().min(5).max(400).default(100),
  container: z.enum(CONTAINERS).default('mov'),
});
export type EncodingSettings = z.infer<typeof EncodingSettingsSchema>;

export const DEFAULT_FILENAME_TEMPLATE = '{subject}_{place}_{motion}_{date}_{n}';

export const ExportSettingsSchema = z.object({
  ollamaUrl: z.url().default('http://localhost:11434'),
  model: z.string().min(1).default('gemma4:31b'),
  /** Ollama "thinking" mode — slower, sometimes better. */
  think: z.boolean().default(false),
  llmTimeoutSec: z.number().int().min(30).max(3600).default(600),
  keepAlive: z.string().min(1).default('30m'),
  temperature: z.number().min(0).max(2).default(0.3),

  /** Skip manual review and cut right after metadata generation. */
  autoApprove: z.boolean().default(false),
  /** Clips processed in parallel by the non-LLM steps (LLM calls are always sequential). */
  concurrency: z.number().int().min(1).max(8).default(2),

  encoding: EncodingSettingsSchema.default(EncodingSettingsSchema.parse({})),
  slowMoConform: z.enum(SLOW_MO_CONFORM).default('off'),
  embedGps: z.boolean().default(false),
  creationTimeMode: z.enum(CREATION_TIME_MODES).default('auto'),
  /** Placeholders: {subject} {place} {motion} {date} {n}. Output is always [a-z0-9_]. */
  filenameTemplate: z.string().min(1).max(120).default(DEFAULT_FILENAME_TEMPLATE),

  adobeAuthor: z.string().max(100).default('author'),
  copyright: z.string().max(200).default(''),
  pond5Price: z.number().min(0).default(50),
  pond5PriceLarge: z.number().min(0).default(100),
  envatoPriceSingle: z.number().min(0).default(15),
  envatoPriceMulti: z.number().min(0).default(30),

  poiRadiusM: z.number().int().min(100).max(10_000).default(2000),
  nominatimUserAgent: z
    .string()
    .min(5)
    .default('stock-video-editor/0.2 (set your contact e-mail in export settings)'),
  /** Also query OpenStreetMap Overpass for tourism/historic/natural/man_made objects. */
  useOverpass: z.boolean().default(false),

  enabledPlatforms: z.array(z.string()).default(['adobe', 'shutterstock', 'pond5', 'envato']),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = ExportSettingsSchema.parse({});
