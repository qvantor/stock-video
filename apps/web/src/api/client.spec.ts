import { z } from 'zod';
import { ApiError, apiRequest } from './client';

const respond = (res: Response) => {
  const fetchMock = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('apiRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends GET without body or headers and validates the response', async () => {
    const fetchMock = respond(new Response(JSON.stringify({ id: 'p1' })));
    await expect(apiRequest(z.object({ id: z.string() }), '/projects/p1')).resolves.toEqual({
      id: 'p1',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p1', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('serializes a JSON body with content-type', async () => {
    const fetchMock = respond(new Response(JSON.stringify({ ok: true })));
    await apiRequest(z.unknown(), '/projects', { method: 'POST', body: { name: 'A' } });
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"A"}',
    });
  });

  it('parses undefined for 204 responses', async () => {
    respond(new Response(null, { status: 204 }));
    await expect(apiRequest(z.undefined(), '/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws ApiError with the error field of the body', async () => {
    respond(new Response(JSON.stringify({ error: 'Project is confirmed' }), { status: 409 }));
    const err = await apiRequest(z.unknown(), '/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Project is confirmed' });
  });

  it('falls back to the status text when the body has no error', async () => {
    respond(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(apiRequest(z.unknown(), '/x')).rejects.toMatchObject({
      status: 502,
      message: '502 Bad Gateway',
    });
    respond(new Response(JSON.stringify({ message: 'x' }), { status: 500, statusText: 'Oops' }));
    await expect(apiRequest(z.unknown(), '/x')).rejects.toMatchObject({ message: '500 Oops' });
  });

  it('rejects a response that does not match the schema', async () => {
    respond(new Response(JSON.stringify({ id: 1 })));
    await expect(apiRequest(z.object({ id: z.string() }), '/x')).rejects.toBeInstanceOf(z.ZodError);
  });
});
