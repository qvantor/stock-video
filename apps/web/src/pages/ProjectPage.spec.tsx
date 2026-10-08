import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { Project, ProjectSummary, SourceVideo } from '@dfs/contracts';
import { useUploadStore } from '../uploads/uploadStore';
import {
  currentPath,
  FakeEventSource,
  makeProject,
  makeVideo,
  polyfillDialog,
  renderWithProviders,
  stubFetch,
} from '../test/utils';
import { ProjectPage } from './ProjectPage';

type FetchRoutes = Parameters<typeof stubFetch>[0];

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  videoCount: 2,
  readyCount: 2,
  failedCount: 0,
  processingCount: 0,
  proposedSegments: 5,
  acceptedSegments: 3,
  acceptedDurationSec: 75,
  issueCount: 0,
  canConfirm: true,
  blockers: [],
  ...over,
});

const setup = ({
  project = makeProject(),
  videos = [makeVideo({ id: 'v1', reviewed: true }), makeVideo({ id: 'v2' })],
  sum = summary(),
  routes = {},
}: {
  project?: Project;
  videos?: SourceVideo[];
  sum?: ProjectSummary;
  routes?: FetchRoutes;
} = {}) => {
  const fetch = stubFetch({
    'GET /api/projects/p1': project,
    'GET /api/projects/p1/videos': videos,
    'GET /api/projects/p1/summary': sum,
    ...routes,
  });
  const view = renderWithProviders(<ProjectPage />, {
    route: '/projects/p1',
    path: '/projects/:projectId',
  });
  return { ...view, ...fetch };
};

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const mutations = (calls: { method: string; url: string }[]) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);

const initialUploads = useUploadStore.getState();

describe('ProjectPage', () => {
  beforeAll(polyfillDialog);
  beforeEach(() => {
    FakeEventSource.install();
    useUploadStore.setState(initialUploads, true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows loading and then the project, subscribing to its events', async () => {
    setup();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Kizhi' });
    expect(FakeEventSource.last().url).toBe('/api/projects/p1/events');
  });

  it('shows a load error', async () => {
    setup({
      routes: {
        'GET /api/projects/p1': new Response(JSON.stringify({ error: 'Project not found' }), {
          status: 404,
        }),
      },
    });
    await screen.findByText('Project not found');
  });

  it('opens the first unchecked video for review', async () => {
    setup();
    await screen.findByText('Videos');
    await waitFor(() => expect(button('Review segments (1 left)').disabled).toBe(false));
    fireEvent.click(button('Review segments (1 left)'));
    expect(currentPath()).toBe('/projects/p1/videos/v2');
  });

  it('explains why review is unavailable', async () => {
    setup({ videos: [makeVideo({ reviewed: true })] });
    await waitFor(() =>
      expect(button('Review segments').getAttribute('title')).toBe('All videos are checked'),
    );
    expect(button('Review segments').disabled).toBe(true);
  });

  it('explains that no video is ready yet', async () => {
    setup({ videos: [makeVideo({ status: 'analyzing', progress: 0.5 })] });
    await screen.findByText(/Analysing motion/);
    expect(button('Review segments').getAttribute('title')).toBe('No videos ready yet');
  });

  it('blocks confirmation while videos are processing and shows the blockers', async () => {
    setup({
      videos: [makeVideo({ id: 'v1' }), makeVideo({ id: 'v2', status: 'proxy', progress: 0.1 })],
      sum: summary({ canConfirm: false, blockers: ['1 video is still processing'] }),
    });
    await screen.findByText('2/2 ready');
    expect(button('Confirm segments').disabled).toBe(true);
    expect(button('Confirm segments').getAttribute('title')).toBe('1 video is still processing');
  });

  it('opens the confirm dialog once everything is settled', async () => {
    setup();
    await screen.findByText('2/2 ready');
    expect(screen.getByText('Proposed segments').nextElementSibling?.textContent).toBe('5');
    expect(screen.getByText('Total duration').nextElementSibling?.textContent).toBe('1:15');
    await waitFor(() => expect(button('Confirm segments').disabled).toBe(false));
    fireEvent.click(button('Confirm segments'));
    expect(screen.getByRole('heading', { name: 'Confirm segments' })).toBeTruthy();
  });

  it('shows the warning count in the summary', async () => {
    setup({ sum: summary({ issueCount: 2 }) });
    await screen.findByText('Warnings');
    expect(screen.getByText('Warnings').nextElementSibling?.textContent).toBe('2');
  });

  it('shows an empty drop zone without videos', async () => {
    setup({ videos: [], sum: summary({ videoCount: 0, readyCount: 0 }) });
    await screen.findByText('Drop videos here');
  });

  it('is read-only once confirmed and can be reopened', async () => {
    const confirm = vi.fn((_message: string) => true);
    vi.stubGlobal('confirm', confirm);
    const project = makeProject({ status: 'confirmed', manifestPath: '/data/p1/manifest.json' });
    const { calls } = setup({
      project,
      routes: {
        'POST /api/projects/p1/reopen': { ...project, status: 'draft', manifestPath: null },
      },
    });
    await screen.findByText('/data/p1/manifest.json');
    expect(screen.getByRole('link', { name: 'Export →' }).getAttribute('href')).toBe(
      '/projects/p1/export',
    );
    expect(screen.queryByRole('button', { name: /Review segments/ })).toBeNull();
    await screen.findAllByText('DJI_0001.MP4');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    fireEvent.click(button('Reopen'));
    expect(confirm.mock.calls[0][0]).toContain('Reopen the project for editing?');
    await waitFor(() => expect(mutations(calls)).toEqual(['POST /api/projects/p1/reopen']));
  });

  it('shows a reopen error', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    setup({
      project: makeProject({ status: 'confirmed' }),
      routes: {
        'POST /api/projects/p1/reopen': new Response(
          JSON.stringify({ error: 'Archive is building' }),
          {
            status: 409,
          },
        ),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen' }));
    await screen.findByText('Failed to reopen the project: Archive is building');
  });

  it('deletes the project after confirmation and goes home', async () => {
    const confirm = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirm);
    const cancelProject = vi.fn();
    useUploadStore.setState({ cancelProject });
    const { calls } = setup({ routes: { 'DELETE /api/projects/p1': undefined } });
    await screen.findAllByText('DJI_0001.MP4');

    fireEvent.click(button('Delete project'));
    expect(confirm.mock.calls[0][0]).toContain('Delete project “Kizhi”?');
    expect(confirm.mock.calls[0][0]).toContain('removes 2 videos');
    expect(mutations(calls)).toEqual([]);

    confirm.mockReturnValue(true);
    fireEvent.click(button('Delete project'));
    expect(cancelProject).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(mutations(calls)).toEqual(['DELETE /api/projects/p1']);
  });

  it('wires video card actions to the API', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const failed = makeVideo({ id: 'v3', originalFilename: 'BROKEN.MP4', status: 'failed' });
    const { calls } = setup({
      videos: [makeVideo({ id: 'v1', reviewed: true }), failed],
      routes: {
        'PUT /api/videos/v1/reviewed': makeVideo({ id: 'v1', reviewed: false }),
        'POST /api/videos/v3/retry': { ...failed, status: 'queued' },
        'DELETE /api/videos/v3': undefined,
      },
    });
    await screen.findByText('BROKEN.MP4');
    fireEvent.click(button('Uncheck'));
    fireEvent.click(button('Retry'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    await waitFor(() =>
      expect(mutations(calls).sort()).toEqual([
        'DELETE /api/videos/v3',
        'POST /api/videos/v3/retry',
        'PUT /api/videos/v1/reviewed',
      ]),
    );
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ reviewed: false });
  });
});
