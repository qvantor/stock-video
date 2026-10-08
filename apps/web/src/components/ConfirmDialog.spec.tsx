import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ProjectSummary } from '@dfs/contracts';
import {
  currentPath,
  makeProject,
  polyfillDialog,
  renderWithProviders,
  stubFetch,
} from '../test/utils';
import { ConfirmDialog } from './ConfirmDialog';

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  videoCount: 3,
  readyCount: 2,
  failedCount: 0,
  processingCount: 0,
  proposedSegments: 6,
  acceptedSegments: 4,
  acceptedDurationSec: 95,
  issueCount: 0,
  canConfirm: true,
  blockers: [],
  ...over,
});

const confirmResponse = {
  manifestPath: '/data/projects/p1/manifest.json',
  manifest: {
    manifestVersion: 1,
    projectId: 'p1',
    confirmedAt: '2024-07-15T10:00:00.000Z',
    settings: makeProject().analysisSettings,
    videos: [],
  },
};

const setup = (s: ProjectSummary, onClose = vi.fn()) => {
  renderWithProviders(<ConfirmDialog projectId="p1" summary={s} onClose={onClose} />);
  return onClose;
};

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('ConfirmDialog', () => {
  beforeAll(polyfillDialog);
  afterEach(() => vi.unstubAllGlobals());

  it('shows the summary of what will be confirmed', () => {
    stubFetch({});
    setup(summary());
    expect(screen.getByText('Videos').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Accepted segments').nextElementSibling?.textContent).toBe('4');
    expect(screen.getByText('Total duration').nextElementSibling?.textContent).toBe('1:35');
    expect(screen.queryByText('Failed videos (excluded)')).toBeNull();
    expect(button('Confirm').disabled).toBe(false);
  });

  it('shows failed videos, invalid segments and other blockers', () => {
    stubFetch({});
    setup(
      summary({
        failedCount: 1,
        issueCount: 2,
        canConfirm: false,
        blockers: ['Invalid segments: 2', 'Some videos are still processing'],
      }),
    );
    expect(screen.getByText('Failed videos (excluded)').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText(/There are invalid accepted segments \(2\)/)).toBeTruthy();
    expect(screen.getByText('Some videos are still processing')).toBeTruthy();
    expect(screen.queryByText('Invalid segments: 2')).toBeNull();
    expect(button('Confirm').disabled).toBe(true);
  });

  it('confirms and offers to open the export', async () => {
    const { calls } = stubFetch({ 'POST /api/projects/p1/confirm': confirmResponse });
    setup(summary());
    fireEvent.click(button('Confirm'));
    await screen.findByText('/data/projects/p1/manifest.json');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/projects/p1/confirm')).toBe(
      true,
    );
    expect(button('Close')).toBeTruthy();
    fireEvent.click(button('Open export'));
    expect(currentPath()).toBe('/projects/p1/export');
  });

  it('shows the server error', async () => {
    stubFetch({
      'POST /api/projects/p1/confirm': new Response(
        JSON.stringify({ error: 'Not all videos are settled' }),
        { status: 409 },
      ),
    });
    setup(summary());
    fireEvent.click(button('Confirm'));
    await screen.findByText('Not all videos are settled');
    expect(button('Confirm')).toBeTruthy();
  });

  it('closes on Cancel', async () => {
    stubFetch({});
    const onClose = setup(summary());
    fireEvent.click(button('Cancel'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
