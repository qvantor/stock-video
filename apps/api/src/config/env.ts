import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  /** Root for uploaded sources, proxies, sprites, analysis caches and manifests. */
  DATA_DIR: z.string().min(1).default('./data'),
  /** SQLite file. In Docker it lives in a named volume, outside the bind-mounted DATA_DIR. */
  DB_PATH: z.string().min(1).optional(),
  /** How DATA_DIR is seen from the host (Docker bind mount) — only used to display paths. */
  DATA_DIR_HOST: z.string().min(1).optional(),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3333),
  /** How many videos are processed (proxy + analysis) at the same time. */
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  /** Default Ollama URL for export settings (in Docker: http://host.docker.internal:11434). */
  OLLAMA_URL: z.url().optional(),
  /** Default model for export settings. */
  OLLAMA_MODEL: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface AppConfig {
  dataDir: string;
  /** DATA_DIR as seen by the user (differs inside Docker). */
  dataDirHost: string;
  dbPath: string;
  host: string;
  port: number;
  queueConcurrency: number;
  ffmpegPath: string;
  ffprobePath: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  /** Overrides for the export settings defaults. */
  ollamaUrl: string | null;
  ollamaModel: string | null;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.DATA_DIR);
  return {
    dataDir,
    dataDirHost: e.DATA_DIR_HOST ?? dataDir,
    dbPath: path.resolve(e.DB_PATH ?? path.join(dataDir, 'app.sqlite')),
    host: e.HOST,
    port: e.PORT,
    queueConcurrency: e.QUEUE_CONCURRENCY,
    ffmpegPath: e.FFMPEG_PATH,
    ffprobePath: e.FFPROBE_PATH,
    logLevel: e.LOG_LEVEL,
    ollamaUrl: e.OLLAMA_URL ?? null,
    ollamaModel: e.OLLAMA_MODEL ?? null,
  };
};
