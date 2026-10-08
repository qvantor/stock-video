import { render, screen } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_EXPORT_SETTINGS } from '@dfs/contracts';
import { FakeEventSource, makeProject, makeQueryClient, makeVideo, stubFetch } from '../test/utils';
import App from './app';

const renderAt = (route: string) =>
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('App', () => {
  beforeEach(() => {
    FakeEventSource.install();
    HTMLMediaElement.prototype.pause = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the projects page', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const { getByText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>,
    );
    expect(getByText('Projects')).toBeTruthy();
  });

  it('routes /projects/:projectId to the project page', async () => {
    stubFetch({
      '/api/projects/p1': makeProject({ name: 'Kizhi' }),
      '/api/projects/p1/videos': [],
    });
    renderAt('/projects/p1');
    await screen.findByRole('heading', { name: 'Kizhi' });
    expect(screen.getByText('Analysis parameters')).toBeTruthy();
  });

  it('routes /projects/:projectId/videos/:videoId to the editor', async () => {
    stubFetch({
      '/api/projects/p1': makeProject(),
      '/api/projects/p1/videos': [makeVideo({ id: 'v1', status: 'queued' })],
    });
    renderAt('/projects/p1/videos/v1');
    await screen.findByText('The video is still being processed (queued).');
  });

  it('routes /projects/:projectId/export to the export page', () => {
    stubFetch({ '/api/projects/p1': makeProject({ status: 'confirmed' }) });
    renderAt('/projects/p1/export');
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(FakeEventSource.last().url).toBe('/api/projects/p1/events');
  });

  it('routes /settings/export to the export settings page', async () => {
    stubFetch({ '/api/settings/export': DEFAULT_EXPORT_SETTINGS });
    renderAt('/settings/export');
    await screen.findByRole('heading', { name: 'Export settings' });
  });
});
