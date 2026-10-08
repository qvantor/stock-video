import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, stubFetch } from '../test/utils';
import { SystemStatusDot } from './SystemStatusDot';

const check = (id: string, ok: boolean, message: string | null = null) => ({
  id,
  label: id.toUpperCase(),
  ok,
  message,
});

const label = () => screen.getByRole('status').getAttribute('aria-label');

describe('SystemStatusDot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is pending while the status loads', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderWithProviders(<SystemStatusDot />);
    expect(label()).toBe('Checking systems…');
  });

  it('reports all systems healthy', async () => {
    stubFetch({ '/api/status': { checks: [check('db', true), check('ffmpeg', true)] } });
    renderWithProviders(<SystemStatusDot />);
    await waitFor(() => expect(label()).toBe('All systems healthy'));
    expect(screen.getByText('DB')).toBeTruthy();
  });

  it('reports partially failing systems with their messages', async () => {
    stubFetch({
      '/api/status': {
        checks: [check('db', true), check('ollama', false, 'Ollama is not running')],
      },
    });
    renderWithProviders(<SystemStatusDot />);
    await waitFor(() => expect(label()).toBe('1 of 2 systems down'));
    expect(screen.getByText('Ollama is not running')).toBeTruthy();
  });

  it('reports all systems down', async () => {
    stubFetch({ '/api/status': { checks: [check('db', false), check('ffmpeg', false)] } });
    renderWithProviders(<SystemStatusDot />);
    await waitFor(() => expect(label()).toBe('2 of 2 systems down'));
  });

  it('reports an unreachable API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderWithProviders(<SystemStatusDot />);
    await waitFor(() => expect(label()).toBe('API is not reachable'));
    expect(screen.getByText('The server is not reachable.')).toBeTruthy();
  });
});
