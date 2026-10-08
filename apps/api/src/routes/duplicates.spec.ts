import type { DuplicateCheckResponse, Project } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

const FP = 'a'.repeat(64);

describe('POST /api/videos/duplicates', () => {
  let h: TestHarness;
  let projectA: Project;

  const createProject = async (name: string) =>
    (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name } })
    ).json<Project>();

  beforeEach(async () => {
    h = await createHarness();
    projectA = await createProject('Alps 2026');
    const id = h.services.videos.createUploading({
      projectId: projectA.id,
      uploadId: 'u1',
      originalFilename: 'DJI_0001.MP4',
      sizeBytes: 5000,
    }).id;
    h.services.videos.update(id, {
      uploadId: null,
      storedPath: '/data/videos/x/source.mp4',
      status: 'ready',
      progress: 1,
      durationSec: 42.5,
      fps: 30,
      width: 3840,
      height: 2160,
      codec: 'hevc',
      fingerprint: FP,
    });
  });
  afterEach(() => h.close());

  const check = async (file: Record<string, unknown>) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/videos/duplicates',
      payload: { files: [{ key: 'k', filename: 'copy.mp4', ...file }] },
    });
    expect(res.statusCode).toBe(200);
    return res.json<DuplicateCheckResponse>().matches['k'];
  };

  it('finds the same file in another project with its project name and metadata', async () => {
    await createProject('Coast');
    const found = await check({ sizeBytes: 5000, fingerprint: FP, durationSec: 42.52 });
    expect(found).toEqual([
      expect.objectContaining({
        projectId: projectA.id,
        projectName: 'Alps 2026',
        originalFilename: 'DJI_0001.MP4',
        durationSec: 42.5,
        width: 3840,
        height: 2160,
        codec: 'hevc',
        status: 'ready',
      }),
    ]);
  });

  it('matches without a duration when the browser could not read it', async () => {
    expect(await check({ sizeBytes: 5000, fingerprint: FP })).toHaveLength(1);
  });

  it('does not match a different size, fingerprint or duration', async () => {
    expect(await check({ sizeBytes: 5001, fingerprint: FP })).toBeUndefined();
    expect(await check({ sizeBytes: 5000, fingerprint: 'b'.repeat(64) })).toBeUndefined();
    expect(await check({ sizeBytes: 5000, fingerprint: FP, durationSec: 43 })).toBeUndefined();
  });

  it('ignores videos that are still uploading', async () => {
    h.services.videos.createUploading({
      projectId: projectA.id,
      uploadId: 'u2',
      originalFilename: 'DJI_0002.MP4',
      sizeBytes: 7000,
      fingerprint: FP,
    });
    expect(await check({ sizeBytes: 7000, fingerprint: FP })).toBeUndefined();
  });

  it('rejects a malformed fingerprint', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/videos/duplicates',
      payload: { files: [{ key: 'k', filename: 'x.mp4', sizeBytes: 1, fingerprint: 'nope' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
