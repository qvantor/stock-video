import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_EXPORT_SETTINGS,
  emptyStatusCounts,
  type ExportJob,
  type ExportState,
} from '@dfs/contracts';
import { makeClip, makeQueryClient, stubFetch } from '../test/utils';
import {
  applyClipProgress,
  applyClips,
  applyJob,
  exportKeys,
  useApprove,
  useExportState,
  useSaveExportSettings,
} from './export';

const job = (over: Partial<ExportJob> = {}): ExportJob => ({
  id: 'j1',
  projectId: 'p1',
  createdAt: '2024-07-15T10:00:00.000Z',
  total: 2,
  excluded: 0,
  counts: emptyStatusCounts(),
  progress: 0,
  canBuild: false,
  buildStatus: 'idle',
  buildError: null,
  archive: null,
  ...over,
});

const state = (): ExportState => ({
  job: job(),
  clips: [makeClip({ id: 'c1' }), makeClip({ id: 'c2', ordinal: 1 })],
  videos: [],
});

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

const cached = (qc: QueryClient) => qc.getQueryData<ExportState | null>(exportKeys.state('p1'));

describe('export cache helpers', () => {
  it('applyClips replaces clips by id and keeps the rest', () => {
    const qc = makeQueryClient();
    qc.setQueryData(exportKeys.state('p1'), state());
    applyClips(qc, 'p1', [makeClip({ id: 'c2', approved: true }), makeClip({ id: 'zz' })]);
    expect(cached(qc)?.clips.map((c) => [c.id, c.approved])).toEqual([
      ['c1', false],
      ['c2', true],
    ]);
  });

  it('applyJob replaces the job', () => {
    const qc = makeQueryClient();
    qc.setQueryData(exportKeys.state('p1'), state());
    applyJob(qc, 'p1', job({ progress: 0.5 }));
    expect(cached(qc)?.job.progress).toBe(0.5);
  });

  it('applyClipProgress patches status and progress of one clip', () => {
    const qc = makeQueryClient();
    qc.setQueryData(exportKeys.state('p1'), state());
    applyClipProgress(qc, 'p1', 'c1', { status: 'cut', progress: 0.3 });
    expect(cached(qc)?.clips[0]).toMatchObject({ status: 'cut', progress: 0.3 });
    expect(cached(qc)?.clips[1]).toMatchObject({ status: 'review', progress: 0 });
  });

  it('leaves a missing or null state untouched', () => {
    const qc = makeQueryClient();
    applyJob(qc, 'p1', job());
    expect(cached(qc)).toBeUndefined();
    qc.setQueryData(exportKeys.state('p1'), null);
    applyClips(qc, 'p1', [makeClip()]);
    expect(cached(qc)).toBeNull();
  });
});

describe('export hooks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('useExportState maps 404 to null', async () => {
    stubFetch({});
    const qc = makeQueryClient();
    const { result } = renderHook(() => useExportState('p1'), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('useExportState surfaces other errors', async () => {
    stubFetch({ '/api/projects/p1/export': new Response('{}', { status: 500 }) });
    const { result } = renderHook(() => useExportState('p1'), {
      wrapper: wrapper(makeQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useApprove posts clip ids and applies the returned clips', async () => {
    const { calls } = stubFetch({
      'POST /api/clips/approve': [makeClip({ id: 'c1', approved: true })],
    });
    const qc = makeQueryClient();
    qc.setQueryData(exportKeys.state('p1'), state());
    const { result } = renderHook(() => useApprove('p1'), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(['c1']));
    expect(calls[0]).toMatchObject({ method: 'POST', body: { clipIds: ['c1'] } });
    expect(cached(qc)?.clips[0].approved).toBe(true);
  });

  it('useSaveExportSettings stores settings and invalidates health', async () => {
    const qc = makeQueryClient();
    qc.setQueryData(exportKeys.health, { ok: true, message: null });
    const { calls } = stubFetch({ 'PUT /api/settings/export': (b: unknown) => b });
    const { result } = renderHook(() => useSaveExportSettings(), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(DEFAULT_EXPORT_SETTINGS));
    expect(calls[0]).toMatchObject({ method: 'PUT', body: DEFAULT_EXPORT_SETTINGS });
    expect(qc.getQueryData(exportKeys.settings)).toEqual(DEFAULT_EXPORT_SETTINGS);
    expect(qc.getQueryState(exportKeys.health)?.isInvalidated).toBe(true);
  });
});
