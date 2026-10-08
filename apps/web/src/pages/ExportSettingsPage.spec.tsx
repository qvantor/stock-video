import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DEFAULT_EXPORT_SETTINGS, type StockPlatformInfo } from '@dfs/contracts';
import { renderWithProviders, stubFetch } from '../test/utils';
import { ExportSettingsPage } from './ExportSettingsPage';

type FetchRoutes = Parameters<typeof stubFetch>[0];

const platforms: StockPlatformInfo[] = [
  { id: 'adobe', label: 'Adobe Stock', lastVerified: '2026-01-01', verified: true },
  { id: 'envato', label: 'Envato', lastVerified: '2026-01-01', verified: false },
];

const settings = { ...DEFAULT_EXPORT_SETTINGS, enabledPlatforms: ['adobe'] };

const setup = (routes: FetchRoutes = {}) => {
  const fetch = stubFetch({
    'GET /api/settings/export': settings,
    'PUT /api/settings/export': (body: unknown) => body,
    '/api/stock-platforms': platforms,
    '/api/export/health': {
      ok: true,
      url: 'http://localhost:11434',
      model: 'gemma4:31b',
      message: null,
    },
    ...routes,
  });
  renderWithProviders(<ExportSettingsPage />, { route: '/settings/export' });
  return fetch;
};

const field = (label: string) =>
  screen.getByText(label).closest('label')?.querySelector('input, select') as
    HTMLInputElement | HTMLSelectElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const ready = () => screen.findByRole('heading', { name: 'Export settings' });

describe('ExportSettingsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows loading and then the settings with model health', async () => {
    setup();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await ready();
    expect((field('Model') as HTMLInputElement).value).toBe('gemma4:31b');
    await screen.findByText('Ollama is reachable, gemma4:31b is installed.');
    expect(button('Save').disabled).toBe(true);
    expect(button('Reset').disabled).toBe(true);
  });

  it('shows the health problem', async () => {
    setup({
      '/api/export/health': {
        ok: false,
        url: 'http://localhost:11434',
        model: 'gemma4:31b',
        message: 'Model is not installed',
      },
    });
    await screen.findByText('Model is not installed');
  });

  it('shows a load error', async () => {
    setup({
      'GET /api/settings/export': new Response(JSON.stringify({ error: 'Settings unavailable' }), {
        status: 500,
      }),
    });
    await screen.findByText('Settings unavailable');
  });

  it('shows H.264 quality fields only for the H.264 codec', async () => {
    setup();
    await ready();
    expect(screen.getByText('Quality (CRF)')).toBeTruthy();
    fireEvent.change(field('Codec'), { target: { value: 'prores_hq' } });
    expect(screen.queryByText('Quality (CRF)')).toBeNull();
    expect(screen.queryByText('Max bitrate at 4K')).toBeNull();
  });

  it('toggles platforms and marks unverified ones', async () => {
    const { calls } = setup();
    await ready();
    await screen.findByText('Envato *');
    expect(screen.getByText(/CSV layout not yet verified/)).toBeTruthy();
    const adobe = screen.getByText('Adobe Stock').querySelector('input') as HTMLInputElement;
    const envato = screen.getByText('Envato *').querySelector('input') as HTMLInputElement;
    expect(adobe.checked).toBe(true);
    expect(envato.checked).toBe(false);

    fireEvent.click(adobe);
    fireEvent.click(envato);
    fireEvent.click(button('Save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      enabledPlatforms: ['envato'],
    });
  });

  it('shows validation errors and blocks saving', async () => {
    setup();
    await ready();
    fireEvent.change(field('Parallel clips'), { target: { value: '20' } });
    expect(screen.getByText(/^concurrency: /)).toBeTruthy();
    expect(button('Save').disabled).toBe(true);
    expect(button('Reset').disabled).toBe(false);
  });

  it('saves the changed settings and confirms', async () => {
    const { calls } = setup();
    await ready();
    fireEvent.change(field('Model'), { target: { value: 'qwen3:14b' } });
    fireEvent.click(field('Auto-approve'));
    fireEvent.change(field('Container'), { target: { value: 'mp4' } });
    fireEvent.click(button('Save'));
    await screen.findByText('Saved');
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      ...settings,
      model: 'qwen3:14b',
      autoApprove: true,
      encoding: { ...settings.encoding, container: 'mp4' },
    });
  });

  it('shows a save error', async () => {
    setup({
      'PUT /api/settings/export': new Response(JSON.stringify({ error: 'Read-only storage' }), {
        status: 500,
      }),
    });
    await ready();
    fireEvent.change(field('Model'), { target: { value: 'qwen3:14b' } });
    fireEvent.click(button('Save'));
    await screen.findByText('Read-only storage');
  });

  it('resets the draft to the stored settings', async () => {
    setup();
    await ready();
    fireEvent.change(field('Model'), { target: { value: 'qwen3:14b' } });
    fireEvent.click(button('Reset'));
    expect((field('Model') as HTMLInputElement).value).toBe('gemma4:31b');
    expect(button('Save').disabled).toBe(true);
  });
});
