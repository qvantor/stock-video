import path from 'node:path';

/** On-disk layout inside DATA_DIR. */
export class DataPaths {
  constructor(
    readonly root: string,
    /** The same directory as seen from the host (for paths shown to the user). */
    readonly hostRoot: string = root,
  ) {}

  /** Translate a path inside DATA_DIR into the user's (host) view. */
  toHost(p: string): string {
    const rel = path.relative(this.root, p);
    return rel.startsWith('..') ? p : path.join(this.hostRoot, rel);
  }

  get uploads(): string {
    return path.join(this.root, 'uploads');
  }

  get videosRoot(): string {
    return path.join(this.root, 'videos');
  }

  projectDir(projectId: string): string {
    return path.join(this.root, 'projects', projectId);
  }

  manifest(projectId: string): string {
    return path.join(this.projectDir(projectId), 'manifest.json');
  }

  videoDir(videoId: string): string {
    return path.join(this.videosRoot, videoId);
  }

  source(videoId: string, originalFilename: string): string {
    const ext = path.extname(originalFilename).toLowerCase() || '.mp4';
    return path.join(this.videoDir(videoId), `source${ext}`);
  }

  proxy(videoId: string): string {
    return path.join(this.videoDir(videoId), 'proxy.mp4');
  }

  sprite(videoId: string): string {
    return path.join(this.videoDir(videoId), 'sprite.jpg');
  }

  features(videoId: string): string {
    return path.join(this.videoDir(videoId), 'features.json');
  }

  metrics(videoId: string): string {
    return path.join(this.videoDir(videoId), 'metrics.json');
  }

  /** Intermediate stage-2 files (frames, cut clips) per export job. */
  exportWork(jobId: string): string {
    return path.join(this.root, 'export-work', jobId);
  }

  clipWork(jobId: string, clipId: string): string {
    return path.join(this.exportWork(jobId), clipId);
  }

  /** Finished export folders and zip archives. */
  get exportsRoot(): string {
    return path.join(this.root, 'exports');
  }

  /** Raw LLM requests/responses for prompt debugging. */
  get llmLogs(): string {
    return path.join(this.root, 'llm-logs');
  }
}

/** Public URLs for files served by the /media static route. */
/** Public URL of a clip's preview frame (`variant=llm` for the downscaled model input). */
export const frameUrl = (clipId: string, index: number): string =>
  `/api/clips/${clipId}/frames/${index}`;

export const exportDownloadUrl = (jobId: string): string => `/api/exports/${jobId}/download`;

export const mediaUrl = (videoId: string, file: 'proxy.mp4' | 'sprite.jpg'): string =>
  `/media/${videoId}/${file}`;
