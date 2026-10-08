import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Project, Segment, SourceVideo } from '@dfs/contracts';
import { useEditorStore } from '../editor/store';
import {
  currentPath,
  FakeEventSource,
  makeProject,
  makeSegment,
  makeVideo,
  renderWithProviders,
  stubFetch,
} from '../test/utils';
import { EditorPage } from './EditorPage';

type FetchRoutes = Parameters<typeof stubFetch>[0];

// The real timeline draws on a canvas; a stub exposing the segment count is enough here.
vi.mock('@dfs/timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dfs/timeline')>()),
  Timeline: ({ segments }: { segments: unknown[] }) => (
    <div data-testid="timeline">{segments.length} on timeline</div>
  ),
}));

const initialEditor = useEditorStore.getState();

const segments: Segment[] = [
  makeSegment({ id: 'a', startSec: 0, endSec: 10, accepted: true }),
  makeSegment({ id: 'b', startSec: 20, endSec: 30, accepted: false }),
];

const setup = ({
  project = makeProject(),
  videos = [makeVideo({ id: 'v1' }), makeVideo({ id: 'v2', originalFilename: 'DJI_0002.MP4' })],
  segs = segments,
  videoId = 'v1',
  routes = {},
}: {
  project?: Project;
  videos?: SourceVideo[];
  segs?: Segment[];
  videoId?: string;
  routes?: FetchRoutes;
} = {}) => {
  const fetch = stubFetch({
    'GET /api/projects/p1': project,
    'GET /api/projects/p1/videos': videos,
    [`GET /api/videos/${videoId}/segments`]: segs,
    [`PUT /api/videos/${videoId}/segments`]: (body: unknown) =>
      (body as { segments: unknown }).segments,
    [`GET /api/videos/${videoId}/metrics`]: new Response('{}', { status: 404 }),
    ...routes,
  });
  const view = renderWithProviders(<EditorPage />, {
    route: `/projects/p1/videos/${videoId}`,
    path: '/projects/:projectId/videos/:videoId',
  });
  return { ...view, ...fetch };
};

const press = (code: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(window, { code, ...init });
  });
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const loaded = () => screen.findByText('2 on timeline');

describe('EditorPage', () => {
  beforeAll(() => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.pause = vi.fn();
  });
  beforeEach(() => {
    FakeEventSource.install();
    useEditorStore.setState(initialEditor, true);
  });
  afterEach(() => {
    // Unmount first: autosave flushes pending edits through the stubbed fetch.
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows loading, then the video with its segments', async () => {
    setup();
    expect(screen.getByText('Loading…')).toBeTruthy();
    await loaded();
    expect(screen.getByRole('heading', { name: 'DJI_0001.MP4' })).toBeTruthy();
    expect(screen.getByText('3840×2160 · 29.97 fps')).toBeTruthy();
    expect(screen.getByText('Accepted 1 of 2')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.getByText('2 left to review')).toBeTruthy();
  });

  it('tells the user a video is still processing', async () => {
    setup({ videos: [makeVideo({ status: 'proxy', progress: 0.3 })] });
    await screen.findByText('The video is still being processed (proxy).');
    expect(screen.getByRole('link', { name: '← Back to project' }).getAttribute('href')).toBe(
      '/projects/p1',
    );
  });

  it('toggles acceptance of the segment under the playhead with A, and undoes it', async () => {
    setup();
    await loaded();
    press('KeyA');
    expect(screen.getByText('Accepted 0 of 2')).toBeTruthy();
    expect(screen.getByText('Unsaved changes…')).toBeTruthy();
    press('KeyZ', { ctrlKey: true });
    expect(screen.getByText('Accepted 1 of 2')).toBeTruthy();
    press('KeyZ', { metaKey: true, shiftKey: true });
    expect(screen.getByText('Accepted 0 of 2')).toBeTruthy();
  });

  it('selects from the list, deletes with Delete and clears the selection with Escape', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getAllByRole('button', { name: /00:20\.00/ })[0]);
    expect(screen.getByText('Duration: 10.00 s')).toBeTruthy();
    press('Escape');
    expect(screen.queryByText('Duration: 10.00 s')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /00:20\.00/ })[0]);
    press('Delete');
    expect(screen.getByText('1 on timeline')).toBeTruthy();
    expect(screen.getByText('Accepted 1 of 1')).toBeTruthy();
  });

  it('merges selected segments with M', async () => {
    setup();
    await loaded();
    act(() => useEditorStore.getState().select(['a', 'b']));
    press('KeyM');
    expect(screen.getByText('1 on timeline')).toBeTruthy();
  });

  it('creates a segment from in/out points', async () => {
    setup({ segs: [] });
    await waitFor(() => expect(useEditorStore.getState().videoId).toBe('v1'));
    expect(button('Segment from I–O (N)').disabled).toBe(true);
    act(() => {
      useEditorStore.getState().setInPoint(30);
      useEditorStore.getState().setOutPoint(45);
    });
    press('KeyN');
    expect(screen.getByText('1 on timeline')).toBeTruthy();
    expect(useEditorStore.getState().segments[0]).toMatchObject({ origin: 'user', accepted: true });
    expect(useEditorStore.getState().inPoint).toBeNull();
  });

  it('counts validation warnings', async () => {
    setup({ segs: [makeSegment({ id: 'short', startSec: 0, endSec: 3 })] });
    await screen.findByText('1 on timeline');
    expect(screen.getByText('⚠ Warnings: 1')).toBeTruthy();
  });

  it('ignores edits on a confirmed project', async () => {
    setup({ project: makeProject({ status: 'confirmed' }) });
    await loaded();
    expect(screen.getByText('Read-only (project confirmed)')).toBeTruthy();
    press('KeyA');
    expect(screen.getByText('Accepted 1 of 2')).toBeTruthy();
    expect(button('Split (S)').disabled).toBe(true);
  });

  it('marks the video checked and moves on to the next unchecked one', async () => {
    const { calls } = setup({
      routes: { 'PUT /api/videos/v1/reviewed': makeVideo({ id: 'v1', reviewed: true }) },
    });
    await loaded();
    fireEvent.click(button('Next →'));
    await waitFor(() => expect(currentPath()).toBe('/projects/p1/videos/v2'));
    expect(calls.find((c) => c.url === '/api/videos/v1/reviewed')?.body).toEqual({
      reviewed: true,
    });
  });

  it('finishes on the last video and returns to the project', async () => {
    const { calls } = setup({
      videos: [makeVideo({ id: 'v1', reviewed: true })],
    });
    await loaded();
    fireEvent.click(button('Finish'));
    await waitFor(() => expect(currentPath()).toBe('/projects/p1'));
    expect(calls.some((c) => c.url.endsWith('/reviewed'))).toBe(false);
  });

  it('walks videos in order without checking them on a confirmed project', async () => {
    const { calls } = setup({
      project: makeProject({ status: 'confirmed' }),
      videos: [
        makeVideo({ id: 'v1' }),
        makeVideo({ id: 'v2', status: 'failed' }),
        makeVideo({ id: 'v3' }),
      ],
    });
    await loaded();
    fireEvent.click(button('Next →'));
    await waitFor(() => expect(currentPath()).toBe('/projects/p1/videos/v3'));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('toggles the shortcut help', async () => {
    setup();
    await loaded();
    expect(screen.queryByText('split at playhead')).toBeNull();
    fireEvent.click(button('Shortcuts'));
    expect(screen.getByText('split at playhead')).toBeTruthy();
  });
});
