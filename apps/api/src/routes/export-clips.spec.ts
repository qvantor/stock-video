import fs from 'node:fs';
import path from 'node:path';
import type {
  ClipStep,
  ExportClip,
  ExportState,
  OllamaHealth,
  Project,
  StockCategories,
} from '@dfs/contracts';
import type { PipelineSteps } from '@dfs/export-pipeline';
import { createHarness, type TestHarness } from '../test/harness.js';
import { fakeExportSteps } from '../test/export-fakes.js';
import { confirmProject, createProject, putSegments, seedReadyVideo, seg } from '../test/seed.js';

describe('export clip actions API', () => {
  let h: TestHarness;
  let project: Project;
  let videoId: string;
  let runs: Record<ClipStep, number>;
  /** Number of upcoming geo runs that should fail. */
  let geoFailures: number;

  beforeEach(async () => {
    runs = { frames: 0, geo: 0, tech: 0, llm: 0, cut: 0 };
    geoFailures = 0;
    const steps: PipelineSteps = fakeExportSteps(runs);
    const frames = steps.frames;
    const geo = steps.geo;
    steps.frames = {
      ...frames,
      // Write preview frames like the real step so the frames route can serve them.
      run: async (ctx) => {
        const dir = h.services.paths.clipWork(ctx.job.id, ctx.clip.id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'frame_0.jpg'), Buffer.from('full-jpeg'));
        fs.writeFileSync(path.join(dir, 'frame_0_llm.jpg'), Buffer.from('llm-jpeg'));
        return frames.run(ctx);
      },
    };
    steps.geo = {
      ...geo,
      run: async (ctx) => {
        if (geoFailures > 0) {
          geoFailures--;
          throw new Error('Nominatim timed out');
        }
        return geo.run(ctx);
      },
    };
    h = await createHarness({ exportSteps: steps });
    project = await createProject(h);
    videoId = seedReadyVideo(h, project.id).id;
    await putSegments(h, videoId, [seg(videoId, 'a', 0, 20), seg(videoId, 'b', 40, 60)]);
  });
  afterEach(async () => {
    await h.services.exports.pipeline.onIdle();
    await h.close();
  });

  const getState = async () =>
    (
      await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` })
    ).json<ExportState>();
  const clips = async () => {
    const [a, b] = (await getState()).clips;
    if (!a || !b) throw new Error('expected two clips');
    return [a, b] as const;
  };

  describe('POST /api/projects/:id/export', () => {
    it('requires a confirmed project', async () => {
      const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('Confirm the segments');
    });

    it('reports an unreadable manifest', async () => {
      h.services.projects.markConfirmed(project.id, h.services.paths.manifest(project.id));
      const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export` });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('manifest.json cannot be read');
    });

    it('resumes the export of a confirmed project', async () => {
      await confirmProject(h, project.id);
      const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export` });
      expect(res.statusCode).toBe(200);
      expect(res.json<ExportState>().clips).toHaveLength(2);
    });
  });

  it('a failed step is reported on the clip and POST /clips/:id/retry resumes from it', async () => {
    geoFailures = 1;
    await confirmProject(h, project.id);
    const failed = (await getState()).clips.find((c) => c.status === 'failed');
    expect(failed).toMatchObject({ failedStep: 'geo', error: 'Nominatim timed out' });
    if (!failed) throw new Error('expected a failed clip');

    const res = await h.app.inject({ method: 'POST', url: `/api/clips/${failed.id}/retry` });
    expect(res.statusCode).toBe(200);
    expect(res.json<ExportClip>()).toMatchObject({ status: 'geo', error: null, failedStep: null });
    await h.services.exports.pipeline.onIdle();
    expect((await getState()).clips.map((c) => c.status)).toEqual(['review', 'review']);
    // Frames are not re-run; geo succeeded once per clip (the failed attempt is not counted).
    expect(runs).toMatchObject({ frames: 2, geo: 2, tech: 2, llm: 2 });

    const again = await h.app.inject({ method: 'POST', url: `/api/clips/${failed.id}/retry` });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: string }>().error).toContain('Only failed clips');
  });

  it('POST /clips/:id/regenerate re-runs only the LLM step with the user hint', async () => {
    await confirmProject(h, project.id);
    const [a] = await clips();
    await h.app.inject({ method: 'POST', url: '/api/clips/approve', payload: { clipIds: [a.id] } });
    await h.services.exports.pipeline.onIdle();
    const before = { ...runs };

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/clips/${a.id}/regenerate`,
      payload: { hint: '  island church  ', poiName: 'Kizhi Pogost' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ExportClip>()).toMatchObject({
      status: 'llm',
      approved: false,
      userHint: 'island church',
      poiOverride: 'Kizhi Pogost',
    });
    await h.services.exports.pipeline.onIdle();
    expect(runs).toEqual({ ...before, llm: before.llm + 1 });
    expect((await clips())[0].status).toBe('review');

    expect(
      (await h.app.inject({ method: 'POST', url: '/api/clips/nope/regenerate', payload: {} }))
        .statusCode,
    ).toBe(404);
  });

  it('bulk keyword add and remove are case-insensitive', async () => {
    await confirmProject(h, project.id);
    const [a, b] = await clips();
    const bulk = (payload: object) =>
      h.app.inject({ method: 'POST', url: '/api/clips/keywords', payload });

    const added = await bulk({ op: 'add', clipIds: [a.id, b.id], keyword: 'Onega' });
    expect(added.statusCode).toBe(200);
    expect(added.json<ExportClip[]>().every((c) => c.metadata?.keywords.at(-1) === 'onega')).toBe(
      true,
    );
    // Adding an existing keyword in another case is a no-op.
    const dup = await bulk({ op: 'add', clipIds: [a.id], keyword: 'KIZHI' });
    const keywords = dup.json<ExportClip[]>()[0]?.metadata?.keywords ?? [];
    expect(keywords.filter((k) => k.toLowerCase() === 'kizhi')).toHaveLength(1);

    const removed = await bulk({ op: 'remove', clipIds: [a.id], keyword: 'ONEGA' });
    expect(removed.json<ExportClip[]>()[0]?.metadata?.keywords).not.toContain('onega');
    expect((await clips())[1].metadata?.keywords).toContain('onega');

    expect((await bulk({ op: 'add', clipIds: ['nope'], keyword: 'x' })).statusCode).toBe(404);
  });

  it('PATCH /clips/:id/metadata answers 404 for unknown clips and 409 before metadata exists', async () => {
    const patch = (id: string) =>
      h.app.inject({ method: 'PATCH', url: `/api/clips/${id}/metadata`, payload: { title: 'X' } });
    expect((await patch('nope')).statusCode).toBe(404);

    geoFailures = 2;
    await confirmProject(h, project.id);
    const [a] = await clips();
    expect(a.metadata).toBeNull();
    const res = await patch(a.id);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toContain('no metadata yet');
  });

  describe('GET /api/clips/:id/frames/:index', () => {
    it('serves the full and LLM frame variants', async () => {
      await confirmProject(h, project.id);
      const [a] = await clips();
      const full = await h.app.inject({ method: 'GET', url: `/api/clips/${a.id}/frames/0` });
      expect(full.statusCode).toBe(200);
      expect(full.body).toBe('full-jpeg');
      expect(full.headers['cache-control']).toBe('no-cache');
      const llm = await h.app.inject({
        method: 'GET',
        url: `/api/clips/${a.id}/frames/0?variant=llm`,
      });
      expect(llm.body).toBe('llm-jpeg');
    });

    it('validates the index and variant and reports missing frames', async () => {
      await confirmProject(h, project.id);
      const [a] = await clips();
      const get = (url: string) => h.app.inject({ method: 'GET', url });
      expect((await get(`/api/clips/${a.id}/frames/1`)).statusCode).toBe(404);
      expect((await get(`/api/clips/${a.id}/frames/10`)).statusCode).toBe(400);
      expect((await get(`/api/clips/${a.id}/frames/x`)).statusCode).toBe(400);
      expect((await get(`/api/clips/${a.id}/frames/0?variant=thumb`)).statusCode).toBe(400);
      expect((await get('/api/clips/nope/frames/0')).statusCode).toBe(404);
    });
  });

  describe('PATCH /api/videos/:id/location', () => {
    it('stores a trimmed value or null without an export job', async () => {
      const patch = (location: string | null) =>
        h.app.inject({
          method: 'PATCH',
          url: `/api/videos/${videoId}/location`,
          payload: { location },
        });
      expect((await patch('  Kizhi  ')).statusCode).toBe(204);
      expect(h.services.videos.getRow(videoId).manualLocation).toBe('Kizhi');
      expect((await patch('   ')).statusCode).toBe(204);
      expect(h.services.videos.getRow(videoId).manualLocation).toBeNull();
      expect((await patch(null)).statusCode).toBe(204);
      expect(runs.geo).toBe(0);
    });

    it('answers 404 for an unknown video', async () => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/videos/nope/location',
        payload: { location: 'x' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('archive', () => {
    it('refuses a second build while one is running and 404s unbuilt downloads', async () => {
      await confirmProject(h, project.id);
      const ids = (await getState()).clips.map((c) => c.id);
      await h.app.inject({ method: 'POST', url: '/api/clips/approve', payload: { clipIds: ids } });
      await h.services.exports.pipeline.onIdle();
      const { job } = await getState();

      expect(
        (await h.app.inject({ method: 'GET', url: `/api/exports/${job.id}/download` })).statusCode,
      ).toBe(404);
      expect(
        (await h.app.inject({ method: 'GET', url: '/api/exports/nope/download' })).statusCode,
      ).toBe(404);

      const build = () =>
        h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export/build` });
      expect((await build()).statusCode).toBe(202);
      const second = await build();
      expect(second.statusCode).toBe(409);
      expect(second.json<{ error: string }>().error).toContain('already being built');
      await vi.waitFor(async () => expect((await getState()).job.buildStatus).toBe('built'), {
        timeout: 5000,
      });
    });

    it('build answers 404 without an export job', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/export/build`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  it('GET /api/stock-categories lists the platform category options', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/stock-categories' });
    expect(res.statusCode).toBe(200);
    const body = res.json<StockCategories>();
    for (const list of Object.values(body)) expect(Array.isArray(list)).toBe(true);
    expect(Object.keys(body).length).toBeGreaterThan(0);
  });

  it('GET /api/export/health reports an unreachable Ollama', async () => {
    h.services.settings.putExport({
      ...h.services.settings.getExport(),
      ollamaUrl: 'http://127.0.0.1:1',
    });
    const res = await h.app.inject({ method: 'GET', url: '/api/export/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json<OllamaHealth>()).toMatchObject({
      ok: false,
      url: 'http://127.0.0.1:1',
      model: h.services.settings.getExport().model,
    });
  });
});
