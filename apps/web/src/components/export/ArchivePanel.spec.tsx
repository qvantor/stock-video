import { render, screen } from '@testing-library/react';
import { emptyStatusCounts, type ExportJob } from '@dfs/contracts';
import { ArchivePanel } from './ArchivePanel';

const job = (over: Partial<ExportJob> = {}): ExportJob => ({
  id: 'j1',
  projectId: 'p1',
  createdAt: '2024-07-15T10:00:00.000Z',
  total: 2,
  excluded: 0,
  counts: { ...emptyStatusCounts(), done: 2 },
  progress: 1,
  canBuild: true,
  buildStatus: 'idle',
  buildError: null,
  archive: null,
  ...over,
});

describe('ArchivePanel', () => {
  it('renders nothing without an archive', () => {
    const { container } = render(<ArchivePanel job={job()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the build in progress', () => {
    render(<ArchivePanel job={job({ buildStatus: 'building' })} />);
    expect(screen.getByText(/Building the archive/)).toBeTruthy();
  });

  it('shows the build error', () => {
    render(<ArchivePanel job={job({ buildStatus: 'failed', buildError: 'Disk full' })} />);
    expect(screen.getByText('Archive build failed: Disk full')).toBeTruthy();
  });

  it('links the built ZIP with its folder and report', () => {
    render(
      <ArchivePanel
        job={job({
          buildStatus: 'built',
          archive: {
            builtAt: '2024-07-15T12:00:00.000Z',
            folderPath: '/exports/kizhi',
            zipUrl: '/api/exports/j1/download',
            zipSizeBytes: 2048,
            reportMd: '# Report',
            clipCount: 2,
          },
        })}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/api/exports/j1/download');
    expect(link.textContent).toBe('Download ZIP (2.0 KB)');
    expect(screen.getByText(/2 clips · built/)).toBeTruthy();
    expect(screen.getByText('/exports/kizhi')).toBeTruthy();
    expect(screen.getByText('# Report')).toBeTruthy();
  });
});
