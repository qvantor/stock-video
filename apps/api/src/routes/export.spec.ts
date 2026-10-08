import fs from 'node:fs';
import path from 'node:path';
import type {
  ClipStep,
  ExportClip,
  ExportJob,
  ExportSettings,
  ExportState,
  Project,
  ProjectEvent,
  Segment,
} from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { fakeExportSteps } from '../test/export-fakes.js';

const seg = (videoId: string, id: string, startSec: number, endSec: number): Segment => ({
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
});

describe('export pipeline API', () => {
  let h: TestHarness;
  let project: Project;
  let videoId: string;
  let runs: Record<ClipStep, number>;
  const events: ProjectEvent[] = [];

  beforeEach(async () => {
    runs = { frames: 0, geo: 0, tech: 0, llm: 0, cut: 0 };
    events.length = 0;
    h = await createHarness({ exportSteps: fakeExportSteps(runs) });
    project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kizhi' } })
    ).json<Project>();
    h.services.bus.subscribe(project.id, (e) => events.push(e));
    videoId = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u1',
      originalFilename: 'DJI_0042.MP4',
      sizeBytes: 1000,
    }).id;
    h.services.videos.update(videoId, {
      uploadId: null,
      storedPath: '/data/videos/x/source.mp4',
      status: 'ready',
      progress: 1,
      durationSec: 120,
      fps: 30,
      width: 3840,
      height: 2160,
      codec: 'hevc',
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
    });
    await h.app.inject({
      method: 'PUT',
      url: `/api/videos/${videoId}/segments`,
      payload: { segments: [seg(videoId, 'a', 0, 20), seg(videoId, 'b', 40, 60)] },
    });
  });
  afterEach(() => h.close());

  const getState = async () =>
    (
      await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` })
    ).json<ExportState>();

  it('confirm starts the pipeline; clips wait for review, approval cuts them', async () => {
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` })).statusCode,
    ).toBe(404);
    const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    expect(res.statusCode).toBe(200);
    await h.services.exports.pipeline.onIdle();

    let state = await getState();
    expect(state.clips.map((c) => c.status)).toEqual(['review', 'review']);
    expect(state.clips[0]?.validations.map((v) => v.platform)).toEqual([
      'adobe',
      'shutterstock',
      'pond5',
      'envato',
    ]);
    expect(state.job).toMatchObject({ total: 2, canBuild: false });
    expect(state.videos[0]).toMatchObject({ id: videoId, originalFilename: 'DJI_0042.MP4' });
    expect(events.some((e) => e.type === 'export.clip.updated')).toBe(true);
    expect(events.some((e) => e.type === 'export.updated')).toBe(true);

    const approve = await h.app.inject({
      method: 'POST',
      url: '/api/clips/approve',
      payload: { clipIds: state.clips.map((c) => c.id) },
    });
    expect(approve.statusCode).toBe(200);
    await h.services.exports.pipeline.onIdle();
    state = await getState();
    expect(state.clips.map((c) => c.status)).toEqual(['done', 'done']);
    expect(state.job.canBuild).toBe(true);
    expect(runs).toEqual({ frames: 2, geo: 2, tech: 2, llm: 2, cut: 2 });
  });

  it('regenerate all discards the export and runs every clip through the whole pipeline again', async () => {
    const regenerate = () =>
      h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export/regenerate` });
    expect((await regenerate()).statusCode).toBe(409);

    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    await h.services.exports.pipeline.onIdle();
    const before = await getState();
    const [a, b] = before.clips;
    await h.app.inject({
      method: 'POST',
      url: '/api/clips/approve',
      payload: { clipIds: [a?.id] },
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/clips/${b?.id}/exclude`,
      payload: { excluded: true },
    });
    await h.services.exports.pipeline.onIdle();

    const res = await regenerate();
    expect(res.statusCode).toBe(200);
    expect(res.json<ExportState>().job.id).not.toBe(before.job.id);
    expect(events.some((e) => e.type === 'export.reset')).toBe(true);
    await h.services.exports.pipeline.onIdle();

    const after = await getState();
    expect(after.clips.map((c) => [c.status, c.excluded, c.approved])).toEqual([
      ['review', false, false],
      ['review', false, false],
    ]);
    expect(runs).toEqual({ frames: 4, geo: 4, tech: 4, llm: 4, cut: 1 });
  });

  it('reopening the project deletes its export', async () => {
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    await h.services.exports.pipeline.onIdle();
    const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/reopen` });
    expect(res.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` })).statusCode,
    ).toBe(404);
  });

  it('builds the archive and serves the ZIP with Range support', async () => {
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    await h.services.exports.pipeline.onIdle();
    const early = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/export/build`,
    });
    expect(early.statusCode).toBe(409);

    const ids = (await getState()).clips.map((c) => c.id);
    await h.app.inject({ method: 'POST', url: '/api/clips/approve', payload: { clipIds: ids } });
    await h.services.exports.pipeline.onIdle();

    const state = await getState();
    expect(state.clips.map((c) => c.filename)).toEqual([
      'wooden_church_orbit_20240714_001.mov',
      'wooden_church_orbit_20240714_002.mov',
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/export/build`,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json<ExportJob>().buildStatus).toBe('building');
    await vi.waitFor(async () => expect((await getState()).job.buildStatus).toBe('built'), {
      timeout: 5000,
    });

    const { job } = await getState();
    expect(job.archive).toMatchObject({ clipCount: 2, zipUrl: `/api/exports/${job.id}/download` });
    expect(job.archive?.reportMd).toContain('# Export report: Kizhi');
    const folder = job.archive?.folderPath ?? '';
    expect(fs.readdirSync(path.join(folder, 'csv')).sort()).toEqual([
      expect.stringMatching(/^adobe_stock_author_\d{4}_\d{2}_\d{2}\.csv$/),
      'envato.csv',
      'pond5.csv',
      'shutterstock.csv',
    ]);

    const full = await h.app.inject({ method: 'GET', url: job.archive?.zipUrl ?? '' });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('application/zip');
    expect(full.headers['accept-ranges']).toBe('bytes');
    const part = await h.app.inject({
      method: 'GET',
      url: job.archive?.zipUrl ?? '',
      headers: { range: 'bytes=0-3' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // Rebuilding without changes reuses the archive (same folder).
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export/build` });
    await vi.waitFor(async () => expect((await getState()).job.buildStatus).toBe('built'));
    expect((await getState()).job.archive?.folderPath).toBe(folder);
    expect(runs.cut).toBe(2);
  });

  it('edits metadata, bulk-edits keywords and excludes clips', async () => {
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    await h.services.exports.pipeline.onIdle();
    const [a, b] = (await getState()).clips;
    if (!a || !b) throw new Error('expected two clips');

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/clips/${a.id}/metadata`,
      payload: { title: 'Kizhi Pogost From Above', editorial: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<ExportClip>()).toMatchObject({
      metadata: { title: 'Kizhi Pogost From Above' },
      editorial: true,
    });

    const bulk = await h.app.inject({
      method: 'POST',
      url: '/api/clips/keywords',
      payload: { op: 'replace', clipIds: [a.id, b.id], find: 'kizhi', replace: 'Kizhi Island' },
    });
    expect(bulk.json<ExportClip[]>().map((c) => c.metadata?.keywords[1])).toEqual([
      'kizhi island',
      'kizhi island',
    ]);

    const excl = await h.app.inject({
      method: 'POST',
      url: `/api/clips/${b.id}/exclude`,
      payload: { excluded: true },
    });
    expect(excl.json<ExportClip>().excluded).toBe(true);
    await h.app.inject({ method: 'POST', url: '/api/clips/approve', payload: { clipIds: [a.id] } });
    await h.services.exports.pipeline.onIdle();
    expect((await getState()).job).toMatchObject({ canBuild: true, excluded: 1 });
  });

  it('changing the video location re-runs geo and the LLM but not frames', async () => {
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    await h.services.exports.pipeline.onIdle();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/videos/${videoId}/location`,
      payload: { location: 'Kizhi, Russia' },
    });
    expect(res.statusCode).toBe(204);
    await h.services.exports.pipeline.onIdle();
    expect(runs).toMatchObject({ frames: 2, geo: 4, tech: 4, llm: 4 });
    expect((await getState()).videos[0]?.manualLocation).toBe('Kizhi, Russia');
  });

  it('stores export settings', async () => {
    const current = (
      await h.app.inject({ method: 'GET', url: '/api/settings/export' })
    ).json<ExportSettings>();
    expect(current.model).toBe('gemma4:31b');
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/settings/export',
      payload: { ...current, autoApprove: true, adobeAuthor: 'jane' },
    });
    expect(put.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/settings/export' })).json<ExportSettings>(),
    ).toMatchObject({ autoApprove: true, adobeAuthor: 'jane' });
    const platforms = await h.app.inject({ method: 'GET', url: '/api/stock-platforms' });
    expect(platforms.json<{ id: string }[]>().map((p) => p.id)).toEqual([
      'adobe',
      'shutterstock',
      'pond5',
      'envato',
    ]);
    const unknown = await h.app.inject({
      method: 'PUT',
      url: '/api/settings/export',
      payload: { ...current, enabledPlatforms: ['adobe', 'istock'] },
    });
    expect(unknown.statusCode).toBe(400);
    const bad = await h.app.inject({
      method: 'PUT',
      url: '/api/settings/export',
      payload: { ...current, slowMoConform: '24' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
