import fs from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import type { Project, ProjectEvent, SourceVideo, VideoMetrics } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { createProject, putSegments, seedReadyVideo, seg } from '../test/seed.js';

describe('video routes', () => {
  let h: TestHarness;
  let project: Project;
  const events: ProjectEvent[] = [];

  beforeEach(async () => {
    events.length = 0;
    h = await createHarness();
    // Re-queued dummy sources fail to probe; keep the expected error out of the test output.
    vi.spyOn(
      (h.services.queue as unknown as { log: FastifyBaseLogger }).log,
      'error',
    ).mockReturnValue(undefined);
    project = await createProject(h);
    h.services.bus.subscribe(project.id, (e) => events.push(e));
  });
  afterEach(async () => {
    await h.services.queue.onIdle();
    await h.close();
  });

  describe('GET /api/projects/:id/videos', () => {
    it('lists the videos of a project', async () => {
      const a = seedReadyVideo(h, project.id, { originalFilename: 'A.MP4' });
      const b = seedReadyVideo(h, project.id, { originalFilename: 'B.MP4' });
      const other = await createProject(h, 'Other');
      seedReadyVideo(h, other.id);

      const res = await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/videos` });
      expect(res.statusCode).toBe(200);
      expect(
        res
          .json<SourceVideo[]>()
          .map((v) => v.id)
          .sort(),
      ).toEqual([a.id, b.id].sort());
    });

    it('answers 404 for an unknown project', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/projects/nope/videos' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/videos/:id', () => {
    it('removes the row, its files and publishes video.deleted', async () => {
      const video = seedReadyVideo(h, project.id);
      const dir = h.services.paths.videoDir(video.id);
      expect(fs.existsSync(dir)).toBe(true);

      const res = await h.app.inject({ method: 'DELETE', url: `/api/videos/${video.id}` });
      expect(res.statusCode).toBe(204);
      expect(fs.existsSync(dir)).toBe(false);
      expect(
        (await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}` })).statusCode,
      ).toBe(404);
      expect(events).toContainEqual({ type: 'video.deleted', videoId: video.id });
    });

    it('answers 404 for an unknown video', async () => {
      const res = await h.app.inject({ method: 'DELETE', url: '/api/videos/nope' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/videos/:id/retry', () => {
    const retry = (id: string) => h.app.inject({ method: 'POST', url: `/api/videos/${id}/retry` });

    it('rejects videos that have not failed', async () => {
      const video = seedReadyVideo(h, project.id);
      const res = await retry(video.id);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('Only failed videos');
    });

    it('rejects failed videos whose upload never completed', async () => {
      const video = seedReadyVideo(h, project.id, { status: 'failed', storedPath: null });
      const res = await retry(video.id);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('upload it again');
    });

    it('re-queues a failed video', async () => {
      const video = seedReadyVideo(h, project.id, { status: 'failed', error: 'boom' });
      const res = await retry(video.id);
      expect(res.statusCode).toBe(200);
      expect(res.json<SourceVideo>()).toMatchObject({ status: 'queued', error: null, progress: 0 });
      // The dummy source cannot be probed, so processing fails again — but it ran.
      await h.services.queue.onIdle();
      expect(h.services.videos.get(video.id).status).toBe('failed');
      expect(events.some((e) => e.type === 'video.updated' && e.video.status === 'probing')).toBe(
        true,
      );
    });

    it('is not allowed once the project is confirmed', async () => {
      const video = seedReadyVideo(h, project.id, { status: 'failed' });
      const ok = seedReadyVideo(h, project.id);
      await putSegments(h, ok.id, [seg(ok.id, 'a', 0, 20)]);
      h.services.projects.markConfirmed(project.id, h.services.paths.manifest(project.id));
      const res = await retry(video.id);
      expect(res.statusCode).toBe(409);
    });
  });

  describe('reanalysis', () => {
    it('POST /api/videos/:id/reanalyze rejects videos that are not ready', async () => {
      const video = seedReadyVideo(h, project.id, { status: 'analyzing' });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/videos/${video.id}/reanalyze`,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });

    it('POST /api/videos/:id/reanalyze queues a video without cached features and clears its review', async () => {
      const video = seedReadyVideo(h, project.id, { reviewed: true });
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/videos/${video.id}/reanalyze`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ mode: string; video: SourceVideo }>()).toMatchObject({
        mode: 'queued',
        video: { status: 'queued', reviewed: false },
      });
    });

    it('POST /api/projects/:id/reanalyze saves the settings and re-runs ready videos only', async () => {
      seedReadyVideo(h, project.id);
      seedReadyVideo(h, project.id);
      seedReadyVideo(h, project.id, { status: 'failed' });
      const settings = { ...project.analysisSettings, minDuration: 5, maxDuration: 30 };
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/reanalyze`,
        payload: settings,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ segmented: 0, queued: 2 });
      expect(h.services.projects.get(project.id).analysisSettings).toEqual(settings);
    });

    it('POST /api/projects/:id/reanalyze rejects invalid settings', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/reanalyze`,
        payload: { ...project.analysisSettings, minDuration: 50, maxDuration: 10 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/videos/:id/metrics', () => {
    const metrics: VideoMetrics = {
      fps: 5,
      t: [0, 0.2],
      speed: [0.1, 0.2],
      smoothness: [0.9, 0.8],
      motion: ['forward', 'forward'],
    };

    it('serves the stored metrics file', async () => {
      const video = seedReadyVideo(h, project.id);
      fs.writeFileSync(h.services.paths.metrics(video.id), JSON.stringify(metrics));
      const res = await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/metrics` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(metrics);
    });

    it('answers 404 when the metrics are missing or invalid', async () => {
      const video = seedReadyVideo(h, project.id);
      const get = () => h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/metrics` });
      expect((await get()).statusCode).toBe(404);
      fs.writeFileSync(h.services.paths.metrics(video.id), JSON.stringify({ fps: 5 }));
      expect((await get()).statusCode).toBe(404);
      expect(
        (await h.app.inject({ method: 'GET', url: '/api/videos/nope/metrics' })).statusCode,
      ).toBe(404);
    });
  });
});
