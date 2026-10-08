import type { Project, ProjectEvent, ProjectSummary, Segment } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { createProject, putSegments, seedReadyVideo, seg } from '../test/seed.js';

describe('segment routes', () => {
  let h: TestHarness;
  let project: Project;

  beforeEach(async () => {
    h = await createHarness();
    project = await createProject(h);
  });
  afterEach(() => h.close());

  const summary = async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/summary` });
    expect(res.statusCode).toBe(200);
    return res.json<ProjectSummary>();
  };

  describe('GET/PUT /api/videos/:id/segments', () => {
    it('stores segments, returns them sorted and publishes segments.updated', async () => {
      const video = seedReadyVideo(h, project.id);
      const events: ProjectEvent[] = [];
      h.services.bus.subscribe(project.id, (e) => events.push(e));

      const put = await putSegments(h, video.id, [
        seg(video.id, 'b', 40, 60),
        seg(video.id, 'a', 0, 20, { origin: 'user', accepted: false }),
      ]);
      expect(put.statusCode).toBe(200);
      expect(events).toContainEqual({ type: 'segments.updated', videoId: video.id });

      const res = await h.app.inject({ method: 'GET', url: `/api/videos/${video.id}/segments` });
      expect(res.statusCode).toBe(200);
      expect(res.json<Segment[]>().map((s) => [s.id, s.origin, s.accepted])).toEqual([
        ['a', 'user', false],
        ['b', 'ai', true],
      ]);

      // Replacing with an empty list clears them.
      expect((await putSegments(h, video.id, [])).json()).toEqual([]);
    });

    it('answers 404 for an unknown video', async () => {
      expect(
        (await h.app.inject({ method: 'GET', url: '/api/videos/nope/segments' })).statusCode,
      ).toBe(404);
      expect((await putSegments(h, 'nope', [])).statusCode).toBe(404);
    });

    it('rejects segments beyond the video duration (with a small tolerance)', async () => {
      const video = seedReadyVideo(h, project.id, { durationSec: 60 });
      expect((await putSegments(h, video.id, [seg(video.id, 'a', 40, 60.04)])).statusCode).toBe(
        200,
      );
      const res = await putSegments(h, video.id, [seg(video.id, 'a', 40, 61)]);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toContain('beyond the video duration');
    });

    it('rejects segments whose end is not after the start', async () => {
      const video = seedReadyVideo(h, project.id);
      expect((await putSegments(h, video.id, [seg(video.id, 'a', 20, 10)])).statusCode).toBe(400);
    });

    it('rejects edits once the project is confirmed', async () => {
      const video = seedReadyVideo(h, project.id);
      h.services.projects.markConfirmed(project.id, h.services.paths.manifest(project.id));
      expect((await putSegments(h, video.id, [seg(video.id, 'a', 0, 20)])).statusCode).toBe(409);
    });
  });

  describe('GET /api/projects/:id/summary', () => {
    it('blocks an empty project', async () => {
      const s = await summary();
      expect(s).toMatchObject({ videoCount: 0, canConfirm: false });
      expect(s.blockers).toEqual(['No videos', 'No accepted segments']);
    });

    it('blocks while videos are processing and counts only ready videos', async () => {
      const ready = seedReadyVideo(h, project.id);
      const busy = seedReadyVideo(h, project.id, { status: 'analyzing' });
      seedReadyVideo(h, project.id, { status: 'failed' });
      await putSegments(h, ready.id, [seg(ready.id, 'a', 0, 20)]);
      // Segments of a non-ready video are ignored in the counts.
      h.services.segments.replaceAiSegments(busy.id, [seg(busy.id, 'x', 0, 20)]);

      const s = await summary();
      expect(s).toMatchObject({
        videoCount: 3,
        readyCount: 1,
        failedCount: 1,
        processingCount: 1,
        proposedSegments: 1,
        acceptedSegments: 1,
        acceptedDurationSec: 20,
        canConfirm: false,
      });
      expect(s.blockers).toEqual(['Not all videos are processed']);
    });

    it('requires at least one accepted segment', async () => {
      const video = seedReadyVideo(h, project.id);
      await putSegments(h, video.id, [seg(video.id, 'a', 0, 20, { accepted: false })]);
      const s = await summary();
      expect(s).toMatchObject({ proposedSegments: 1, acceptedSegments: 0, canConfirm: false });
      expect(s.blockers).toEqual(['No accepted segments']);
    });

    it('counts invalid segments once per segment', async () => {
      const video = seedReadyVideo(h, project.id);
      // Too short (below minDuration) and overlapping.
      await putSegments(h, video.id, [seg(video.id, 'a', 0, 3), seg(video.id, 'b', 2, 30)]);
      const s = await summary();
      expect(s.issueCount).toBe(2);
      expect(s.blockers).toEqual([`Invalid segments: ${s.issueCount}`]);
    });

    it('is ready to confirm with accepted, valid segments; then reports confirmed', async () => {
      const video = seedReadyVideo(h, project.id);
      await putSegments(h, video.id, [seg(video.id, 'a', 0, 20)]);
      expect(await summary()).toMatchObject({ canConfirm: true, blockers: [] });

      h.services.projects.markConfirmed(project.id, h.services.paths.manifest(project.id));
      const s = await summary();
      expect(s.canConfirm).toBe(false);
      expect(s.blockers).toEqual(['The project is already confirmed']);
    });

    it('answers 404 for an unknown project', async () => {
      expect(
        (await h.app.inject({ method: 'GET', url: '/api/projects/nope/summary' })).statusCode,
      ).toBe(404);
    });
  });
});
