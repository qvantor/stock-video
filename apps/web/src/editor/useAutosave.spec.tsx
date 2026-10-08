import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { segmentKeys } from '../api/segments';
import { makeQueryClient, makeSegment } from '../test/utils';
import { useEditorStore } from './store';
import { useAutosave } from './useAutosave';

const saveSegments = vi.fn();
vi.mock('../api/segments', async (orig) => ({
  ...(await orig<typeof import('../api/segments')>()),
  saveSegments: (...a: unknown[]) => saveSegments(...a),
}));

const wrapper =
  (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

const edit = (id: string) => act(() => useEditorStore.getState().commit([makeSegment({ id })]));

describe('useAutosave', () => {
  let qc: QueryClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    qc = makeQueryClient();
    saveSegments.mockReset().mockImplementation(async (_id: string, segs: unknown) => segs);
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    useEditorStore.setState({ videoId: null });
    useEditorStore.getState().load('v1', [makeSegment()]);
  });
  afterEach(() => {
    // Unmount (which may flush via fetch) before the fetch stub is removed.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const mount = (enabled = true) =>
    renderHook(() => useAutosave('v1', 'p1', enabled), { wrapper: wrapper(qc) });

  it('debounces edits and saves the latest segments once', async () => {
    mount();
    edit('a');
    await act(() => vi.advanceTimersByTimeAsync(500));
    edit('b');
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(saveSegments).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(saveSegments).toHaveBeenCalledTimes(1);
    expect(saveSegments).toHaveBeenCalledWith('v1', [makeSegment({ id: 'b' })]);
    expect(useEditorStore.getState().saveState).toBe('saved');
    expect(qc.getQueryData(segmentKeys.list('v1'))).toEqual([makeSegment({ id: 'b' })]);
  });

  it('does nothing when disabled', async () => {
    mount(false);
    edit('a');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(saveSegments).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveState).toBe('dirty');
  });

  it('saves again when edits arrive during a save', async () => {
    let finish: (v: unknown) => void = () => undefined;
    saveSegments.mockImplementationOnce(
      (_id: string, segs: unknown) => new Promise((r) => (finish = () => r(segs))),
    );
    mount();
    edit('a');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(useEditorStore.getState().saveState).toBe('saving');
    edit('b');
    await act(async () => finish(undefined));
    expect(useEditorStore.getState().saveState).toBe('dirty');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(saveSegments).toHaveBeenCalledTimes(2);
    expect(saveSegments).toHaveBeenLastCalledWith('v1', [makeSegment({ id: 'b' })]);
    expect(useEditorStore.getState().saveState).toBe('saved');
  });

  it('reports save errors', async () => {
    saveSegments.mockRejectedValueOnce(new Error('Segment extends beyond video duration'));
    mount();
    edit('a');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(useEditorStore.getState()).toMatchObject({
      saveState: 'error',
      saveError: 'Segment extends beyond video duration',
    });
  });

  it('flushes pending edits with keepalive on unmount', () => {
    const { unmount } = mount();
    edit('a');
    unmount();
    expect(saveSegments).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/videos/v1/segments', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segments: [makeSegment({ id: 'a' })] }),
      keepalive: true,
    });
  });

  it('flushes on beforeunload only when there are unsaved edits', async () => {
    mount();
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchMock).not.toHaveBeenCalled();
    edit('a');
    window.dispatchEvent(new Event('beforeunload'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
