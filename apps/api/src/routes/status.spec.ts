import type { SystemStatus } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

const nominatimOk = async () =>
  new Response(JSON.stringify({ status: 0, message: 'OK' }), {
    headers: { 'content-type': 'application/json' },
  });

describe('GET /api/status', () => {
  let h: TestHarness;
  let geocoderCalls: number;

  beforeEach(async () => {
    geocoderCalls = 0;
    h = await createHarness({
      statusFetch: async () => {
        geocoderCalls++;
        return nominatimOk();
      },
    });
    // Nothing listens on port 1, so Ollama is reported as down.
    h.services.settings.putExport({
      ...h.services.settings.getExport(),
      ollamaUrl: 'http://127.0.0.1:1',
    });
  });

  afterEach(() => h.close());

  const getStatus = async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    const { checks } = res.json<SystemStatus>();
    return Object.fromEntries(checks.map((c) => [c.id, c]));
  };

  it('reports every system with its own state', async () => {
    const checks = await getStatus();
    expect(Object.keys(checks)).toEqual(['database', 'storage', 'ffmpeg', 'ollama', 'geocoder']);
    expect(checks['database'].ok).toBe(true);
    expect(checks['storage'].ok).toBe(true);
    expect(checks['geocoder'].ok).toBe(true);
    expect(checks['ollama'].ok).toBe(false);
    expect(checks['ollama'].message).toContain('not reachable');
  });

  it('caches the geocoder status between requests', async () => {
    await getStatus();
    await getStatus();
    expect(geocoderCalls).toBe(1);
  });

  it('reports the geocoder as down when Nominatim fails', async () => {
    await h.close();
    h = await createHarness({ statusFetch: async () => new Response('', { status: 503 }) });
    const checks = await getStatus();
    expect(checks['geocoder'].ok).toBe(false);
    expect(checks['geocoder'].message).toContain('HTTP 503');
  });

  it('reports the geocoder as not reachable when the request throws', async () => {
    await h.close();
    h = await createHarness({
      statusFetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    const checks = await getStatus();
    expect(checks['geocoder'].ok).toBe(false);
    expect(checks['geocoder'].message).toBe('Nominatim is not reachable (getaddrinfo ENOTFOUND)');
  });

  it('reports a Nominatim error status from the response body', async () => {
    await h.close();
    h = await createHarness({
      statusFetch: async () =>
        new Response(JSON.stringify({ status: 700, message: 'database error' }), {
          headers: { 'content-type': 'application/json' },
        }),
    });
    const checks = await getStatus();
    expect(checks['geocoder'].message).toBe('Nominatim reports: database error');
  });
});

describe('GET /api/health', () => {
  it('answers ok', async () => {
    const h = await createHarness();
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await h.close();
    }
  });
});
