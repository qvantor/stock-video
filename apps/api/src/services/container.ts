import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { Server as TusServer } from '@tus/server';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { DataPaths, frameUrl } from '../lib/paths.js';
import { OpencvWorkerAnalyzer, type MotionAnalyzer } from '@dfs/video-analysis';
import { AnalysisService } from './analysis.js';
import { ConfirmService } from './confirm.js';
import { createExportSteps, type PipelineSteps } from '@dfs/export-pipeline';
import { ExportStage2Handler, type SegmentsConfirmedHandler } from './stage2.js';
import { ExportService } from './export.js';
import { DrizzleExportStore } from './export-store.js';
import { ExportVideoSource } from './export-videos.js';
import { SettingsService } from './settings.js';
import { SqliteGeoCache } from './geo-cache.js';
import { GeoService } from '@dfs/geo';
import { loadPrompt, OllamaClient, PROMPT_VERSION } from '@dfs/llm';
import { loadStockConfig, type StockConfig } from '@dfs/stock-csv';
import { resolveAssets } from '../lib/assets.js';
import { EventBus } from './event-bus.js';
import { MediaTools } from './media.js';
import { ProcessingQueue } from './processing.js';
import { ProjectDeletionService } from './project-deletion.js';
import { ProjectService } from './projects.js';
import { SegmentService } from './segments.js';
import { StatusService } from './status.js';
import { StorageService } from './storage.js';
import { createTusServer } from './uploads.js';
import { VideoService } from './videos.js';

export interface Services {
  config: AppConfig;
  paths: DataPaths;
  bus: EventBus;
  projects: ProjectService;
  videos: VideoService;
  segments: SegmentService;
  media: MediaTools;
  analysis: AnalysisService;
  confirm: ConfirmService;
  projectDeletion: ProjectDeletionService;
  queue: ProcessingQueue;
  tus: TusServer;
  settings: SettingsService;
  exports: ExportService;
  status: StatusService;
  storage: StorageService;
  stock: StockConfig;
}

export interface ServiceOverrides {
  /** Motion analyzer implementation (tests use the in-process one). */
  analyzer?: MotionAnalyzer;
  /** Script that runs the flow worker loop (the bundled main.js). */
  workerEntry?: string;
  /** Stage-2 hand-off (default: the export pipeline). */
  stage2?: SegmentsConfirmedHandler;
  /** Directory of the bundled main.js (contains prompts/ and stock-config/ copied by the build). */
  assetsRoot?: string;
  /** Export pipeline steps (tests replace them with fakes). */
  exportSteps?: PipelineSteps;
  /** fetch used by the status checks for external services (tests stub it). */
  statusFetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export const createServices = (
  config: AppConfig,
  db: Db,
  log: FastifyBaseLogger,
  overrides: ServiceOverrides = {},
): Services => {
  const paths = new DataPaths(config.dataDir, config.dataDirHost);
  fs.mkdirSync(paths.uploads, { recursive: true });
  fs.mkdirSync(paths.videosRoot, { recursive: true });

  const bus = new EventBus();
  const projects = new ProjectService(db, bus, paths);
  const videos = new VideoService(db, bus, paths);
  const segments = new SegmentService(db, bus, projects, videos);
  const media = new MediaTools(config);
  const analyzer = overrides.analyzer ?? createWorkerAnalyzer(overrides.workerEntry);
  const analysis = new AnalysisService(
    analyzer,
    config.ffmpegPath,
    paths,
    projects,
    videos,
    segments,
  );
  const queue = new ProcessingQueue(config.queueConcurrency, videos, media, analysis, paths, log);
  const assets = resolveAssets(overrides.assetsRoot);
  const stock = loadStockConfig(assets.stockConfigDir);
  const settings = new SettingsService(db, config);
  const videoSource = new ExportVideoSource(videos, paths, config);
  const geo = new GeoService({ cache: new SqliteGeoCache(db), log });
  const exports = new ExportService({
    store: new DrizzleExportStore(db),
    bus,
    paths,
    projects,
    videos,
    videoSource,
    settings,
    steps:
      overrides.exportSteps ??
      createExportSteps({
        ffmpegPath: config.ffmpegPath,
        clipDir: (jobId, clipId) => paths.clipWork(jobId, clipId),
        frameUrl,
        videos: videoSource,
        geo,
        stock,
        prompt: loadPrompt(PROMPT_VERSION, assets.promptsDir),
        ollama: (baseUrl) => new OllamaClient({ baseUrl }),
        llmLogDir: paths.llmLogs,
      }),
    log,
    stock,
  });
  const confirm = new ConfirmService(
    paths,
    projects,
    videos,
    segments,
    exports,
    overrides.stage2 ?? new ExportStage2Handler(exports, log),
  );
  const projectDeletion = new ProjectDeletionService(
    db,
    bus,
    paths,
    projects,
    videos,
    queue,
    exports,
  );
  const status = new StatusService({
    config,
    db,
    settings,
    exports,
    fetch: overrides.statusFetch,
  });
  const storage = new StorageService({ config, db, paths, exports });
  const tus = createTusServer({ paths, projects, videos, queue, log });
  return {
    config,
    paths,
    bus,
    projects,
    videos,
    segments,
    media,
    analysis,
    confirm,
    projectDeletion,
    queue,
    tus,
    settings,
    exports,
    status,
    storage,
    stock,
  };
};

const createWorkerAnalyzer = (entry: string | undefined): MotionAnalyzer => {
  if (!entry) throw new Error('workerEntry is required for the worker-based motion analyzer');
  return new OpencvWorkerAnalyzer(entry);
};
