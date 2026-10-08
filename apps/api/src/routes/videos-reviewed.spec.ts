import type { Project, SourceVideo } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

describe('video review flag', () => {
  let h: TestHarness;
  let project: Project;
  let videoId: string;

  beforeEach(async () => {
    h = await createHarness();
    project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'p' } })
    ).json<Project>();
    videoId = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u1',
      originalFilename: 'DJI_0001.MP4',
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
    });
  });
  afterEach(() => h.close());

  const setReviewed = (id: string, reviewed: boolean) =>
    h.app.inject({ method: 'PUT', url: `/api/videos/${id}/reviewed`, payload: { reviewed } });
  const getVideo = async () =>
    (await h.app.inject({ method: 'GET', url: `/api/videos/${videoId}` })).json<SourceVideo>();

  it('defaults to unchecked and can be toggled', async () => {
    expect((await getVideo()).reviewed).toBe(false);

    const on = await setReviewed(videoId, true);
    expect(on.statusCode).toBe(200);
    expect(on.json<SourceVideo>().reviewed).toBe(true);
    expect((await getVideo()).reviewed).toBe(true);

    const off = await setReviewed(videoId, false);
    expect(off.json<SourceVideo>().reviewed).toBe(false);
  });

  it('returns 404 for an unknown video', async () => {
    expect((await setReviewed('missing', true)).statusCode).toBe(404);
  });

  it('rejects changes once the project is confirmed', async () => {
    await h.app.inject({
      method: 'PUT',
      url: `/api/videos/${videoId}/segments`,
      payload: {
        segments: [
          {
            id: 'a',
            videoId,
            startSec: 1,
            endSec: 20,
            motionType: 'orbit_left',
            score: 0.9,
            reasons: [],
            origin: 'ai',
            accepted: true,
            edited: false,
          },
        ],
      },
    });
    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/confirm`,
    });
    expect(confirm.statusCode).toBe(200);
    expect((await setReviewed(videoId, true)).statusCode).toBe(409);
  });

  it('is reset by re-analysis', async () => {
    await setReviewed(videoId, true);
    await h.services.analysis.reanalyze(videoId, project.analysisSettings, () => undefined);
    expect((await getVideo()).reviewed).toBe(false);
  });
});
