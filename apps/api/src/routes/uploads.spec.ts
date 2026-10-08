import fs from 'node:fs';
import path from 'node:path';
import type { DuplicateCheckResponse, Project, SourceVideo } from '@dfs/contracts';
import { fileFingerprint } from '../lib/fingerprint.js';
import { createHarness, type TestHarness } from '../test/harness.js';
import { hasFfmpeg, makeTestClip } from '../test/ffmpeg.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

/** tus v2 (srvx) responses are not compatible with light-my-request; use a real socket. */
const listen = async (h: TestHarness): Promise<string> => {
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = h.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
};

describe.skipIf(!hasFfmpeg())('tus upload → processing pipeline', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  it('uploads in chunks, then probes, builds proxy and sprite', async () => {
    const project = (
      await h.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'p' },
      })
    ).json<Project>();
    const clip = path.join(h.dataDir, 'clip.mp4');
    makeTestClip(clip, 6);
    const data = fs.readFileSync(clip);

    const base = await listen(h);
    const created = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: {
        'tus-resumable': '1.0.0',
        'upload-length': String(data.length),
        'upload-metadata': `projectId ${b64(project.id)},filename ${b64('DJI_0001.MP4')}`,
      },
    });
    expect(created.status).toBe(201);
    const location = created.headers.get('location');
    expect(location).toMatch(/^\/api\/uploads\//);

    const half = Math.floor(data.length / 2);
    for (const [from, to] of [
      [0, half],
      [half, data.length],
    ] as const) {
      const res = await fetch(`${base}${location}`, {
        method: 'PATCH',
        headers: {
          'tus-resumable': '1.0.0',
          'upload-offset': String(from),
          'content-type': 'application/offset+octet-stream',
        },
        body: data.subarray(from, to),
      });
      expect(res.status).toBe(204);
    }

    await h.services.queue.onIdle();
    const [video] = (
      await h.app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/videos`,
      })
    ).json<SourceVideo[]>();
    expect(video).toMatchObject({
      originalFilename: 'DJI_0001.MP4',
      status: 'ready',
      codec: 'hevc',
      width: 1280,
      height: 720,
      proxyUrl: `/media/${video?.id}/proxy.mp4`,
    });
    expect(video?.durationSec).toBeCloseTo(6, 0);
    expect(video?.fps).toBeCloseTo(30, 1);
    expect(video?.spriteMeta).toMatchObject({
      columns: 10,
      tileWidth: 160,
      tileHeight: 90,
      count: 3,
    });

    const range = await h.app.inject({
      method: 'GET',
      url: video?.proxyUrl ?? '',
      headers: { range: 'bytes=0-99' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(100);

    const source = await h.app.inject({
      method: 'GET',
      url: `/media/${video?.id}/source.mp4`,
    });
    expect(source.statusCode).toBeGreaterThanOrEqual(400);
  }, 60_000);

  it('links a re-uploaded file to the earlier copy in another project', async () => {
    const createProject = async (name: string) =>
      (
        await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name } })
      ).json<Project>();
    const first = await createProject('First');
    const second = await createProject('Second');
    const clip = path.join(h.dataDir, 'clip.mp4');
    makeTestClip(clip, 3);
    const data = fs.readFileSync(clip);
    const base = await listen(h);

    const upload = async (projectId: string, filename: string) => {
      const created = await fetch(`${base}/api/uploads`, {
        method: 'POST',
        headers: {
          'tus-resumable': '1.0.0',
          'upload-length': String(data.length),
          'upload-metadata': `projectId ${b64(projectId)},filename ${b64(filename)}`,
        },
      });
      const res = await fetch(`${base}${created.headers.get('location')}`, {
        method: 'PATCH',
        headers: {
          'tus-resumable': '1.0.0',
          'upload-offset': '0',
          'content-type': 'application/offset+octet-stream',
        },
        body: data,
      });
      expect(res.status).toBe(204);
      await h.services.queue.onIdle();
    };
    const videosOf = async (projectId: string) =>
      (await h.app.inject({ method: 'GET', url: `/api/projects/${projectId}/videos` })).json<
        SourceVideo[]
      >();

    await upload(first.id, 'DJI_0001.MP4');
    const [original] = await videosOf(first.id);
    expect(original?.duplicateOf).toBeNull();

    // The pre-upload check finds it by the fingerprint the browser would send.
    const fingerprint = await fileFingerprint(clip);
    const check = await h.app.inject({
      method: 'POST',
      url: '/api/videos/duplicates',
      payload: {
        files: [{ key: 'k', filename: 'copy.mp4', sizeBytes: data.length, fingerprint }],
      },
    });
    expect(check.json<DuplicateCheckResponse>().matches['k']).toEqual([
      expect.objectContaining({ videoId: original?.id, projectName: 'First' }),
    ]);

    // "Upload anyway": processing confirms it by the full hash and metadata.
    await upload(second.id, 'copy.mp4');
    const [copy] = await videosOf(second.id);
    expect(copy?.status).toBe('ready');
    expect(copy?.duplicateOf).toEqual({
      videoId: original?.id,
      projectId: first.id,
      projectName: 'First',
      originalFilename: 'DJI_0001.MP4',
    });
    const rows = [original, copy].map((v) => h.services.videos.getRow(v?.id ?? ''));
    expect(rows[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]?.contentHash).toBe(rows[0]?.contentHash);
    expect(rows[1]?.mediaInfo).not.toBeNull();
    expect((await videosOf(first.id))[0]?.duplicateOf).toBeNull();
  }, 60_000);

  it('rejects unsupported file types', async () => {
    const project = (
      await h.app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'p' },
      })
    ).json<Project>();
    const base = await listen(h);
    const res = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: {
        'tus-resumable': '1.0.0',
        'upload-length': '10',
        'upload-metadata': `projectId ${b64(project.id)},filename ${b64('notes.txt')}`,
      },
    });
    expect(res.status).toBe(415);
  });
});
