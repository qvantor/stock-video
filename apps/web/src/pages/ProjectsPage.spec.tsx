import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectListItem, ProjectOverview } from '@dfs/contracts';
import { currentPath, makeProject, renderWithProviders, stubFetch } from '../test/utils';
import { ProjectsPage } from './ProjectsPage';

const sprite = { interval: 2, tileWidth: 160, tileHeight: 90, columns: 10, rows: 1, count: 9 };

const overview = (over: Partial<ProjectOverview> = {}): ProjectOverview => ({
  videoCount: 0,
  statusCounts: {},
  reviewedCount: 0,
  segmentCount: 0,
  acceptedSegments: 0,
  previews: [],
  ...over,
});

const item = (over: Partial<ProjectListItem> = {}): ProjectListItem => ({
  ...makeProject(),
  overview: overview(),
  ...over,
});

const createButton = () => screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
const nameInput = () => screen.getByPlaceholderText(/Project name/) as HTMLInputElement;

describe('ProjectsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a loading state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    renderWithProviders(<ProjectsPage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    stubFetch({ '/api/projects': [] });
    renderWithProviders(<ProjectsPage />);
    await screen.findByText('No projects yet');
  });

  it('shows a load error', async () => {
    stubFetch({
      '/api/projects': new Response(JSON.stringify({ error: 'Database locked' }), { status: 500 }),
    });
    renderWithProviders(<ProjectsPage />);
    await screen.findByText('Failed to load projects: Database locked');
  });

  it('renders project rows with counts and status chips', async () => {
    stubFetch({
      '/api/projects': [
        item({
          id: 'p1',
          name: 'Kizhi',
          overview: overview({
            videoCount: 6,
            statusCounts: { ready: 3, analyzing: 1, queued: 1, failed: 1 },
            reviewedCount: 2,
            segmentCount: 8,
            acceptedSegments: 5,
            previews: ['a', 'b', 'c', 'd'].map((id) => ({
              videoId: id,
              spriteUrl: `/media/${id}/sprite.jpg`,
              spriteMeta: sprite,
            })),
          }),
        }),
        item({
          id: 'p2',
          name: 'Alps',
          status: 'confirmed',
          overview: overview({ videoCount: 1, segmentCount: 1, statusCounts: { ready: 1 } }),
        }),
        item({ id: 'p3', name: 'Empty' }),
      ],
    });
    renderWithProviders(<ProjectsPage />);
    await screen.findByText('Kizhi');

    const row = (name: string) => screen.getByText(name).closest('a') as HTMLAnchorElement;
    const kizhi = row('Kizhi');
    expect(kizhi.getAttribute('href')).toBe('/projects/p1');
    expect(kizhi.textContent).toContain('6 videos');
    expect(kizhi.textContent).toContain('8 segments, 5 accepted');
    expect(kizhi.textContent).toContain('2 of 3 checked');
    expect(kizhi.textContent).toContain('Draft');
    expect(kizhi.textContent).toContain('3 ready');
    expect(kizhi.textContent).toContain('1 failed');
    expect(kizhi.textContent).toContain('+2');
    const processing = screen.getByText('2 processing');
    expect(processing.getAttribute('title')).toBe('Analysing motion: 1\nQueued: 1');

    const alps = row('Alps');
    expect(alps.textContent).toContain('1 video');
    expect(alps.textContent).toContain('1 segment, 0 accepted');
    expect(alps.textContent).toContain('✓ Confirmed');

    const empty = row('Empty');
    expect(empty.textContent).toContain('no videos');
    expect(empty.textContent).toContain('0 segments');
    expect(empty.textContent).not.toContain('checked');
  });

  it('creates a project with a trimmed name and opens it', async () => {
    const { calls } = stubFetch({
      'GET /api/projects': [],
      'POST /api/projects': makeProject({ id: 'p9', name: 'Altai' }),
    });
    renderWithProviders(<ProjectsPage />);
    expect(createButton().disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect(createButton().disabled).toBe(true);

    fireEvent.change(nameInput(), { target: { value: '  Altai  ' } });
    fireEvent.click(createButton());
    await waitFor(() => expect(currentPath()).toBe('/projects/p9'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Altai' });
  });

  it('shows a create error', async () => {
    stubFetch({
      'GET /api/projects': [],
      'POST /api/projects': new Response(JSON.stringify({ error: 'Name is taken' }), {
        status: 409,
      }),
    });
    renderWithProviders(<ProjectsPage />);
    fireEvent.change(nameInput(), { target: { value: 'Altai' } });
    fireEvent.click(createButton());
    await screen.findByText('Name is taken');
  });
});
