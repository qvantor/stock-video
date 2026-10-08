import fs from 'node:fs';
import path from 'node:path';
import type { Project, Segment, SourceVideo } from '@dfs/contracts';
import type { VideoPatch } from '../services/videos.js';
import type { TestHarness } from './harness.js';

export const seg = (
  videoId: string,
  id: string,
  startSec: number,
  endSec: number,
  extra: Partial<Segment> = {},
): Segment => ({
  id,
  videoId,
  startSec,
  endSec,
  motionType: 'orbit_left',
  score: 0.9,
  reasons: [],
  origin: 'ai',
  accepted: true,
  edited: false,
  ...extra,
});

export const createProject = async (h: TestHarness, name = 'Kizhi'): Promise<Project> =>
  (await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name } })).json<Project>();

/**
 * A processed video with a dummy source file inside DATA_DIR.
 * `patch` overrides any column (e.g. `status: 'failed'`, `storedPath: null`).
 */
export const seedReadyVideo = (
  h: TestHarness,
  projectId: string,
  patch: VideoPatch & { originalFilename?: string } = {},
): SourceVideo => {
  const { originalFilename = 'DJI_0042.MP4', ...rest } = patch;
  const video = h.services.videos.createUploading({
    projectId,
    uploadId: `u-${Math.random().toString(36).slice(2)}`,
    originalFilename,
    sizeBytes: 1000,
  });
  const storedPath = h.services.paths.source(video.id, originalFilename);
  fs.mkdirSync(path.dirname(storedPath), { recursive: true });
  fs.writeFileSync(storedPath, Buffer.alloc(1000, 1));
  return h.services.videos.update(video.id, {
    uploadId: null,
    storedPath,
    status: 'ready',
    progress: 1,
    durationSec: 120,
    fps: 30,
    width: 3840,
    height: 2160,
    codec: 'hevc',
    // Probed metadata, so the export pipeline does not need ffprobe.
    mediaInfo: {
      durationSec: 120,
      fps: 30,
      width: 3840,
      height: 2160,
      codec: 'hevc',
      pixFmt: 'yuv420p10le',
      bitDepth: 10,
      colorTransfer: 'rec709',
      hasAudio: false,
      creationTime: null,
      location: null,
      make: 'DJI',
      model: null,
      tags: {},
      djiMetaStream: null,
    },
    ...rest,
  });
};

export const putSegments = (h: TestHarness, videoId: string, segments: Segment[]) =>
  h.app.inject({ method: 'PUT', url: `/api/videos/${videoId}/segments`, payload: { segments } });

/** Confirms the project and waits for the export pipeline to settle. */
export const confirmProject = async (h: TestHarness, projectId: string): Promise<void> => {
  const res = await h.app.inject({ method: 'POST', url: `/api/projects/${projectId}/confirm` });
  if (res.statusCode !== 200) throw new Error(`confirm failed: ${res.body}`);
  await h.services.exports.pipeline.onIdle();
};
