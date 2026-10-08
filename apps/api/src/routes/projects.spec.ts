import { DEFAULT_ANALYSIS_SETTINGS, type Project, type ProjectListItem } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

describe('project routes', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  it('creates, lists and fetches projects', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Altai' },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json<Project>();
    expect(project).toMatchObject({
      name: 'Altai',
      status: 'draft',
      analysisSettings: DEFAULT_ANALYSIS_SETTINGS,
    });

    const list = await h.app.inject({ method: 'GET', url: '/api/projects' });
    expect(list.json<Project[]>().map((p) => p.id)).toEqual([project.id]);

    const one = await h.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    expect(one.json<Project>().id).toBe(project.id);
  });

  it('validates input and returns 404 for unknown projects', async () => {
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/projects',
          payload: { name: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: '/api/projects/nope' })).statusCode).toBe(404);
  });

  it('updates settings and rejects inconsistent ones', async () => {
    const project = (
      await h.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'p' },
      })
    ).json<Project>();
    const ok = await h.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/settings`,
      payload: { ...DEFAULT_ANALYSIS_SETTINGS, includeStatic: true },
    });
    expect(ok.json<Project>().analysisSettings.includeStatic).toBe(true);
    const bad = await h.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/settings`,
      payload: { ...DEFAULT_ANALYSIS_SETTINGS, minDuration: 80 },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('lists projects with an overview of their videos and segments', async () => {
    const project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'p' } })
    ).json<Project>();
    const addVideo = (uploadId: string) =>
      h.services.videos.createUploading({
        projectId: project.id,
        uploadId,
        originalFilename: `${uploadId}.MP4`,
        sizeBytes: 1000,
      }).id;
    const spriteMeta = {
      interval: 1,
      tileWidth: 160,
      tileHeight: 90,
      columns: 10,
      rows: 1,
      count: 10,
    };
    const ready = addVideo('ready');
    h.services.videos.update(ready, {
      uploadId: null,
      storedPath: '/data/videos/x/source.mp4',
      status: 'ready',
      progress: 1,
      durationSec: 60,
      fps: 30,
      spriteMeta,
    });
    h.services.videos.update(addVideo('failed'), { status: 'failed', error: 'boom' });
    addVideo('uploading');

    const segment = (id: string, accepted: boolean) => ({
      id,
      videoId: ready,
      startSec: id === 'a' ? 1 : 20,
      endSec: id === 'a' ? 10 : 30,
      motionType: 'orbit_left' as const,
      score: 0.9,
      reasons: [],
      origin: 'ai' as const,
      accepted,
      edited: false,
    });
    await h.app.inject({
      method: 'PUT',
      url: `/api/videos/${ready}/segments`,
      payload: { segments: [segment('a', true), segment('b', false)] },
    });
    await h.app.inject({
      method: 'PUT',
      url: `/api/videos/${ready}/reviewed`,
      payload: { reviewed: true },
    });
    const empty = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'empty' } })
    ).json<Project>();

    const list = (await h.app.inject({ method: 'GET', url: '/api/projects' })).json<
      ProjectListItem[]
    >();
    expect(list.find((p) => p.id === project.id)?.overview).toEqual({
      videoCount: 3,
      statusCounts: { ready: 1, failed: 1, uploading: 1 },
      reviewedCount: 1,
      segmentCount: 2,
      acceptedSegments: 1,
      previews: [{ videoId: ready, spriteUrl: `/media/${ready}/sprite.jpg`, spriteMeta }],
    });
    expect(list.find((p) => p.id === empty.id)?.overview).toMatchObject({
      videoCount: 0,
      segmentCount: 0,
      previews: [],
    });
  });

  it('rejects settings changes once the project is confirmed', async () => {
    const project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Altai' } })
    ).json<Project>();
    h.services.projects.markConfirmed(project.id, h.services.paths.manifest(project.id));
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/projects/${project.id}/settings`,
      payload: DEFAULT_ANALYSIS_SETTINGS,
    });
    expect(res.statusCode).toBe(409);
  });
});
