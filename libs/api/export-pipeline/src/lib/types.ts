import type {
  ClipFrame,
  ClipMetadata,
  ClipStatus,
  ClipStep,
  ExportArchive,
  ExportSettings,
  GenerationInfo,
  GeoContext,
  MotionType,
  TechContext,
} from '@dfs/contracts';
import type { MediaInfo, TelemetryPoint } from '@dfs/ffmpeg';

export type StepHashes = Partial<Record<ClipStep, string>>;

/** Persisted state of one clip (mirrors the `export_clips` table). */
export interface ClipRecord {
  id: string;
  jobId: string;
  videoId: string;
  segmentId: string;
  ordinal: number;
  startSec: number;
  endSec: number;
  startFrame: number;
  endFrame: number;
  motionType: MotionType;
  status: ClipStatus;
  progress: number;
  failedStep: ClipStep | null;
  error: string | null;
  excluded: boolean;
  approved: boolean;
  frames: ClipFrame[] | null;
  geo: GeoContext | null;
  tech: TechContext | null;
  generation: GenerationInfo | null;
  metadata: ClipMetadata | null;
  editorial: boolean | null;
  userHint: string | null;
  poiOverride: string | null;
  stepHashes: StepHashes;
  cutPath: string | null;
  outputSizeBytes: number | null;
  filename: string | null;
  updatedAt: string;
}

export type ClipPatch = Partial<Omit<ClipRecord, 'id' | 'jobId' | 'videoId' | 'segmentId'>>;

/** Persisted state of an export job (one per project). */
export interface JobRecord {
  id: string;
  projectId: string;
  manifestPath: string;
  createdAt: string;
  buildStatus: 'idle' | 'building' | 'built' | 'failed';
  buildError: string | null;
  archive: ExportArchive | null;
  archiveDir: string | null;
  archiveZip: string | null;
  archiveHash: string | null;
}

export type JobPatch = Partial<Omit<JobRecord, 'id' | 'projectId' | 'createdAt'>>;

/** Persistence port (implemented with drizzle in apps/api, in memory in tests). */
export interface ExportStore {
  findJobByProject(projectId: string): JobRecord | undefined;
  getJob(jobId: string): JobRecord | undefined;
  createJob(job: JobRecord): void;
  updateJob(jobId: string, patch: JobPatch): JobRecord;
  /** Delete a job together with all its clips. */
  deleteJob(jobId: string): void;
  listClips(jobId: string): ClipRecord[];
  getClip(clipId: string): ClipRecord | undefined;
  insertClips(clips: ClipRecord[]): void;
  updateClip(clipId: string, patch: ClipPatch): ClipRecord;
  /** Clips that were in the middle of processing (for resume after a restart). */
  listUnfinishedClips(): ClipRecord[];
}

/** Per-frame sharpness samples (Laplacian variance) from stage 1, on the source timeline. */
export interface SharpnessSeries {
  t: number[];
  sharpness: number[];
}

/** What the pipeline needs to know about a source video. */
export interface VideoInput {
  id: string;
  projectId: string;
  originalFilename: string;
  sourcePath: string;
  media: MediaInfo;
  manualLocation: string | null;
}

/** Source-video port. */
export interface VideoSource {
  getVideo(videoId: string): Promise<VideoInput>;
  getSharpness(videoId: string): Promise<SharpnessSeries | null>;
  /** GPS track embedded in the file (DJI djmd stream), sampled; null if none. */
  getTelemetry(videoId: string): Promise<TelemetryPoint[] | null>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface StepContext {
  clip: ClipRecord;
  video: VideoInput;
  job: JobRecord;
  settings: ExportSettings;
  signal: AbortSignal;
  log: Logger;
  onProgress: (fraction: number) => void;
}

/** One idempotent pipeline step. */
export interface PipelineStep {
  readonly name: ClipStep;
  /** Hash of every input; equal hash + complete output → the step is skipped. */
  hash(ctx: StepContext): string | Promise<string>;
  /** Whether the step's persisted output (DB fields and files) is still present. */
  isComplete(clip: ClipRecord): boolean | Promise<boolean>;
  run(ctx: StepContext): Promise<ClipPatch>;
}

export type PipelineSteps = Record<ClipStep, PipelineStep>;
