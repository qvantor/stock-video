import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { STORAGE_CATEGORIES, type StorageUsage } from '@dfs/contracts';
import { StorageIndicator } from './StorageIndicator';

const GB = 1024 ** 3;
const zero = Object.fromEntries(
  STORAGE_CATEGORIES.map((c) => [c, 0]),
) as StorageUsage['byCategory'];

const usage: StorageUsage = {
  totalBytes: 6 * GB,
  reclaimableBytes: 3 * GB,
  freeBytes: 100 * GB,
  byCategory: { ...zero, sources: 3 * GB, encodedClips: 2 * GB, archives: 1 * GB },
  projects: [
    {
      id: 'p1',
      name: 'Kizhi',
      totalBytes: 6 * GB,
      reclaimableBytes: 3 * GB,
      byCategory: { ...zero, sources: 3 * GB, encodedClips: 2 * GB, archives: 1 * GB },
    },
  ],
  unassigned: { totalBytes: 0, reclaimableBytes: 0, byCategory: zero },
};

describe('StorageIndicator', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/storage/cleanup'
          ? new Response(
              JSON.stringify({ freedBytes: 3 * GB, jobsCleaned: 1, clipsReset: 4, skipped: [] }),
            )
          : new Response(JSON.stringify(usage)),
      ),
    );
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows usage by type and project and frees space after confirmation', async () => {
    const { findByText, getByText, getByLabelText } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StorageIndicator />
      </QueryClientProvider>,
    );
    expect(await findByText('6.0 GB')).toBeTruthy();
    fireEvent.click(getByLabelText('Storage usage'));

    expect(getByText('Source videos')).toBeTruthy();
    expect(getByText('Encoded clips')).toBeTruthy();
    expect(getByText('Kizhi')).toBeTruthy();
    expect(getByText('100 GB free on disk')).toBeTruthy();

    fireEvent.click(getByText('Free up 3.0 GB'));
    expect(window.confirm).toHaveBeenCalled();
    expect(await findByText(/Freed 3\.0 GB · 4 clips are waiting for encoding/)).toBeTruthy();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/storage/cleanup',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
