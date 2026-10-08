import type { EventEmitter } from 'node:events';
import type { Project } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { createProject } from '../test/seed.js';

/** SSE responses are hijacked streams; read them over a real socket. */
const listen = async (h: TestHarness): Promise<string> => {
  await h.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = h.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return `http://127.0.0.1:${addr.port}`;
};

describe('GET /api/projects/:id/events', () => {
  let h: TestHarness;
  let project: Project;

  beforeEach(async () => {
    h = await createHarness();
    project = await createProject(h);
  });
  afterEach(() => h.close());

  const listeners = () =>
    (h.services.bus as unknown as { emitter: EventEmitter }).emitter.listenerCount(project.id);

  it('answers 404 for an unknown project', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/projects/nope/events' });
    expect(res.statusCode).toBe(404);
  });

  it('streams project events and unsubscribes when the client disconnects', async () => {
    const base = await listen(h);
    const ac = new AbortController();
    const res = await fetch(`${base}/api/projects/${project.id}/events`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');

    if (!res.body) throw new Error('no body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before "${needle}"`);
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('retry: 3000\n\n');
    expect(listeners()).toBe(1);

    h.services.bus.publish(project.id, { type: 'video.deleted', videoId: 'v1' });
    h.services.bus.publish('other-project', { type: 'video.deleted', videoId: 'v2' });
    await readUntil('"videoId":"v1"');
    expect(text).toContain(
      `event: video.deleted\ndata: ${JSON.stringify({ type: 'video.deleted', videoId: 'v1' })}\n\n`,
    );
    expect(text).not.toContain('v2');

    ac.abort();
    await vi.waitFor(() => expect(listeners()).toBe(0));
  });
});
