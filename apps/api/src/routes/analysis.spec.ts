import fs from 'node:fs';
import path from 'node:path';
import type { Project, Segment, SourceVideo, VideoMetrics } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { hasFfmpeg, makePanClip } from '../test/ffmpeg.js';

describe.skipIf(!hasFfmpeg())('analysis pipeline on a real clip', () => {
  let h: TestHarness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('analyses a panning clip, stores segments + metrics, and re-segments from cache', async () => {
    const project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'p' } })
    ).json<Project>();
    const clip = path.join(h.dataDir, 'pan.mp4');
    makePanClip(h.dataDir, clip, 30, 60);

    // Register the file as if tus had finished the upload.
    const video = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'test-upload',
      originalFilename: 'pan.mp4',
      sizeBytes: fs.statSync(clip).size,
    });
    const stored = h.services.paths.source(video.id, 'pan.mp4');
    fs.mkdirSync(path.dirname(stored), { recursive: true });
    fs.copyFileSync(clip, stored);
    h.services.videos.update(video.id, { storedPath: stored, uploadId: null });
    h.services.queue.enqueue(video.id);
    await h.services.queue.onIdle();

    const ready = (
      await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}` })
    ).json<SourceVideo>();
    expect(ready.error).toBeNull();
    expect(ready.status).toBe('ready');

    const segments = (
      await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/segments` })
    ).json<Segment[]>();
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ motionType: 'pan_right', origin: 'ai', accepted: true });
    expect(segments[0]?.startSec).toBeCloseTo(0.5, 1);
    expect(segments[0]?.endSec).toBeGreaterThan(28.5);
    // Snapped to source frames (30 fps).
    expect(((segments[0]?.startSec ?? 0) * 30) % 1).toBeCloseTo(0, 6);

    const metrics = (
      await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/metrics` })
    ).json<VideoMetrics>();
    expect(metrics.fps).toBe(5);
    expect(metrics.t.length).toBeGreaterThan(140);
    expect(
      metrics.motion.filter((m) => m === 'pan_right').length / metrics.motion.length,
    ).toBeGreaterThan(0.9);

    // Same fps → segmentation only, from cached features.
    const re = await h.app.inject({
      method: 'POST',
      url: `/api/videos/${video.id}/reanalyze`,
      payload: { settings: { ...project.analysisSettings, maxDuration: 15, targetDuration: 12 } },
    });
    expect(re.json<{ mode: string }>().mode).toBe('segmented');
    const resegmented = (
      await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/segments` })
    ).json<Segment[]>();
    expect(resegmented.length).toBeGreaterThanOrEqual(2);
    for (const s of resegmented) expect(s.endSec - s.startSec).toBeLessThanOrEqual(15.0001);
  }, 120_000);
});
