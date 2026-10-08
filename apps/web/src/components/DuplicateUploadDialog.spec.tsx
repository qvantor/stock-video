import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExistingVideoInfo } from '@dfs/contracts';
import { useUploadStore } from '../uploads/uploadStore';
import { DuplicateUploadDialog } from './DuplicateUploadDialog';

const tusStart = vi.fn();
vi.mock('tus-js-client', () => ({
  Upload: class {
    findPreviousUploads = () => Promise.resolve([]);
    start = tusStart;
  },
}));
vi.mock('../uploads/fingerprint', () => ({
  fileFingerprint: () => Promise.resolve('f'.repeat(64)),
  readDuration: () => Promise.resolve(42.5),
}));

const existing: ExistingVideoInfo = {
  videoId: 'v1',
  projectId: 'p-alps',
  projectName: 'Alps 2026',
  originalFilename: 'DJI_0001.MP4',
  sizeBytes: 3,
  durationSec: 42.5,
  width: 3840,
  height: 2160,
  fps: 29.97,
  codec: 'hevc',
  creationTime: '2026-07-01T10:20:30.000000Z',
  createdAt: '2026-07-02T08:00:00.000Z',
  status: 'ready',
};
const checkDuplicates = vi.fn();
vi.mock('../api/videos', () => ({ checkDuplicates: (...a: unknown[]) => checkDuplicates(...a) }));

describe('DuplicateUploadDialog', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  });
  beforeEach(() => {
    useUploadStore.setState({ uploads: {} });
    tusStart.mockReset();
    checkDuplicates.mockReset();
  });

  const drop = async () => {
    const file = new File(['abc'], 'copy.mp4', { type: 'video/mp4' });
    await act(async () => {
      useUploadStore.getState().addFiles('p-coast', [file]);
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  const renderDialog = () =>
    render(
      <MemoryRouter>
        <DuplicateUploadDialog projectId="p-coast" projectName="Coast" />
      </MemoryRouter>,
    );

  it('holds a duplicate back and shows the existing project and metadata', async () => {
    checkDuplicates.mockImplementation(({ files }: { files: Array<{ key: string }> }) =>
      Promise.resolve({ matches: { [files[0]?.key ?? '']: [existing] } }),
    );
    renderDialog();
    await drop();

    expect(checkDuplicates).toHaveBeenCalledWith({
      files: [expect.objectContaining({ sizeBytes: 3, durationSec: 42.5 })],
    });
    expect(tusStart).not.toHaveBeenCalled();
    expect(screen.getByText('This video is already uploaded')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alps 2026' }).getAttribute('href')).toBe(
      '/projects/p-alps',
    );
    expect(screen.getByText('3840×2160')).toBeTruthy();
    expect(screen.getByText('2026-07-01 10:20:30')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload anyway' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(tusStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('This video is already uploaded')).toBeNull();
  });

  it('skips a duplicate without uploading it', async () => {
    checkDuplicates.mockImplementation(({ files }: { files: Array<{ key: string }> }) =>
      Promise.resolve({ matches: { [files[0]?.key ?? '']: [existing] } }),
    );
    renderDialog();
    await drop();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(Object.keys(useUploadStore.getState().uploads)).toHaveLength(0);
    expect(tusStart).not.toHaveBeenCalled();
  });

  it('uploads files without a match right away', async () => {
    checkDuplicates.mockResolvedValue({ matches: {} });
    renderDialog();
    await drop();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(tusStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('This video is already uploaded')).toBeNull();
  });
});
