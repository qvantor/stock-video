import { fireEvent, screen } from '@testing-library/react';
import type { SourceVideo } from '@dfs/contracts';
import { makeVideo, renderWithProviders } from '../test/utils';
import { VideoCard } from './VideoCard';

const setup = (
  video: SourceVideo,
  opts: { readOnly?: boolean; segmentInfo?: { proposed: number; accepted: number } } = {},
) => {
  const handlers = { onRetry: vi.fn(), onDelete: vi.fn(), onUncheck: vi.fn() };
  const view = renderWithProviders(
    <ul>
      <VideoCard
        video={video}
        readOnly={opts.readOnly ?? false}
        segmentInfo={opts.segmentInfo}
        {...handlers}
      />
    </ul>,
  );
  return { ...view, ...handlers };
};

describe('VideoCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links a ready video to the editor and shows its metadata', () => {
    const { container } = setup(makeVideo({ fps: 30, reviewed: true }), {
      segmentInfo: { proposed: 4, accepted: 3 },
    });
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/videos/v1');
    expect(screen.getByText('3840×2160')).toBeTruthy();
    expect(screen.getByText('30 fps')).toBeTruthy();
    expect(screen.getByText('hevc')).toBeTruthy();
    expect(screen.getByText('✓ Checked')).toBeTruthy();
    expect(screen.getByText(/segments: 4, accepted: 3/)).toBeTruthy();
    expect(screen.getByText('no preview')).toBeTruthy();
  });

  it('keeps fractional fps', () => {
    setup(makeVideo({ fps: 29.97 }));
    expect(screen.getByText('29.97 fps')).toBeTruthy();
  });

  it('does not link a video that is still processing and shows its stage', () => {
    const { container } = setup(makeVideo({ status: 'analyzing', progress: 0.42 }));
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('Analysing motion · 42%')).toBeTruthy();
  });

  it('shows the error of a failed video and offers Retry', () => {
    const { onRetry } = setup(makeVideo({ status: 'failed', error: 'ffprobe exploded' }));
    expect(screen.getByText('Error: ffprobe exploded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('hides Retry when the source file was never stored', () => {
    setup(makeVideo({ status: 'failed', storedPath: null, error: null }));
    expect(screen.getByText('Error: unknown error')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('names the duplicate source in this or another project', () => {
    const dup = {
      videoId: 'v0',
      projectId: 'p1',
      projectName: 'Kizhi',
      originalFilename: 'DJI_0000.MP4',
    };
    const { unmount } = setup(makeVideo({ duplicateOf: dup }));
    expect(screen.getByText('Duplicate of “DJI_0000.MP4” in this project')).toBeTruthy();
    unmount();
    setup(makeVideo({ duplicateOf: { ...dup, projectId: 'p2', projectName: 'Alps' } }));
    expect(screen.getByText('Duplicate of “DJI_0000.MP4” in project “Alps”')).toBeTruthy();
  });

  it('asks for confirmation before deleting', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { onDelete } = setup(makeVideo());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith('Delete “DJI_0001.MP4” and its segments?');
    expect(onDelete).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('offers Uncheck only for reviewed videos', () => {
    const { onUncheck, unmount } = setup(makeVideo({ reviewed: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Uncheck' }));
    expect(onUncheck).toHaveBeenCalled();
    unmount();
    setup(makeVideo({ reviewed: false }));
    expect(screen.queryByRole('button', { name: 'Uncheck' })).toBeNull();
  });

  it('hides all actions in read-only mode', () => {
    setup(makeVideo({ status: 'failed', reviewed: true }), { readOnly: true });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
