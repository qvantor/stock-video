import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHarness, type TestHarness } from '../test/harness.js';

describe('GET /media/:videoId/:file', () => {
  let h: TestHarness;
  const videoId = randomUUID();

  beforeEach(async () => {
    h = await createHarness();
    fs.mkdirSync(h.services.paths.videoDir(videoId), { recursive: true });
    fs.writeFileSync(h.services.paths.proxy(videoId), Buffer.from('0123456789'));
    fs.writeFileSync(h.services.paths.source(videoId, 'a.mp4'), Buffer.from('secret'));
  });
  afterEach(() => h.close());

  const get = (url: string, headers: Record<string, string> = {}) =>
    h.app.inject({ method: 'GET', url, headers });

  it('serves the proxy with range support and no caching', async () => {
    const full = await get(`/media/${videoId}/proxy.mp4`);
    expect(full.statusCode).toBe(200);
    expect(full.body).toBe('0123456789');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cache-control']).toBe('no-cache');
    expect(full.headers['etag']).toBeTruthy();

    const part = await get(`/media/${videoId}/proxy.mp4`, { range: 'bytes=2-4' });
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe('234');
  });

  it('answers 404 for a missing file', async () => {
    expect((await get(`/media/${videoId}/sprite.jpg`)).statusCode).toBe(404);
    expect((await get(`/media/${randomUUID()}/proxy.mp4`)).statusCode).toBe(404);
  });

  it('never serves sources and rejects malformed ids', async () => {
    expect((await get(`/media/${videoId}/source.mp4`)).statusCode).toBe(400);
    expect((await get('/media/not-a-uuid/proxy.mp4')).statusCode).toBe(400);
    expect((await get(`/media/${encodeURIComponent('../videos')}/proxy.mp4`)).statusCode).toBe(400);
  });
});
