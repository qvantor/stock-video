import { act } from '@testing-library/react';
import { emptyStatusCounts, type ExportJob, type ExportState } from '@dfs/contracts';
import { exportKeys } from '../api/export';
import { projectKeys } from '../api/projects';
import { segmentKeys } from '../api/segments';
import { videoKeys } from '../api/videos';
import {
  currentPath,
  FakeEventSource,
  makeClip,
  makeProject,
  makeQueryClient,
  makeVideo,
  renderWithProviders,
} from '../test/utils';
import { useProjectEvents } from './useProjectEvents';

const Probe = () => {
  useProjectEvents('p1');
  return null;
};

const job = (over: Partial<ExportJob> = {}): ExportJob => ({
  id: 'j1',
  projectId: 'p1',
  createdAt: '2024-07-15T10:00:00.000Z',
  total: 1,
  excluded: 0,
  counts: emptyStatusCounts(),
  progress: 0,
  canBuild: false,
  buildStatus: 'idle',
  buildError: null,
  archive: null,
  ...over,
});

const setup = () => {
  const qc = makeQueryClient();
  qc.setQueryData(videoKeys.list('p1'), [makeVideo({ id: 'v1' }), makeVideo({ id: 'v2' })]);
  qc.setQueryData(segmentKeys.summary('p1'), {});
  const utils = renderWithProviders(<Probe />, {
    route: '/projects/p1',
    path: '/projects/:projectId',
    queryClient: qc,
  });
  const es = FakeEventSource.last();
  const emit = (type: string, data: unknown) => act(() => es.emit(type, data));
  const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
  return { ...utils, qc, es, emit, invalidated };
};

describe('useProjectEvents', () => {
  beforeEach(() => FakeEventSource.install());
  afterEach(() => vi.unstubAllGlobals());

  it('subscribes to the project stream and closes it on unmount', () => {
    const { es, unmount } = setup();
    expect(es.url).toBe('/api/projects/p1/events');
    expect([...es.listeners.keys()]).toEqual(
      expect.arrayContaining(['video.progress', 'export.clip.progress', 'open']),
    );
    unmount();
    expect(es.closed).toBe(true);
  });

  it('patches video progress', () => {
    const { qc, emit } = setup();
    emit('video.progress', {
      type: 'video.progress',
      videoId: 'v2',
      status: 'proxy',
      progress: 0.4,
    });
    const list = qc.getQueryData<{ id: string; status: string; progress: number }[]>(
      videoKeys.list('p1'),
    );
    expect(list?.[1]).toMatchObject({ status: 'proxy', progress: 0.4 });
    expect(list?.[0].status).toBe('ready');
  });

  it('replaces a known video and refreshes its segments when it becomes ready', () => {
    const { qc, emit, invalidated } = setup();
    qc.setQueryData(segmentKeys.list('v1'), []);
    qc.setQueryData(videoKeys.metrics('v1'), {});
    emit('video.updated', {
      type: 'video.updated',
      video: makeVideo({ id: 'v1', reviewed: true }),
    });
    expect(qc.getQueryData<{ reviewed: boolean }[]>(videoKeys.list('p1'))?.[0].reviewed).toBe(true);
    expect(invalidated(videoKeys.list('p1'))).toBe(false);
    expect(invalidated(segmentKeys.list('v1'))).toBe(true);
    expect(invalidated(videoKeys.metrics('v1'))).toBe(true);
    expect(invalidated(segmentKeys.summary('p1'))).toBe(true);
  });

  it('refetches the list for an unknown video', () => {
    const { emit, invalidated } = setup();
    emit('video.updated', {
      type: 'video.updated',
      video: makeVideo({ id: 'v9', status: 'queued', progress: 0 }),
    });
    expect(invalidated(videoKeys.list('p1'))).toBe(true);
  });

  it('removes deleted videos', () => {
    const { qc, emit } = setup();
    emit('video.deleted', { type: 'video.deleted', videoId: 'v1' });
    expect(qc.getQueryData<{ id: string }[]>(videoKeys.list('p1'))?.map((v) => v.id)).toEqual([
      'v2',
    ]);
  });

  it('invalidates segments on segments.updated', () => {
    const { qc, emit, invalidated } = setup();
    qc.setQueryData(segmentKeys.list('v1'), []);
    emit('segments.updated', { type: 'segments.updated', videoId: 'v1' });
    expect(invalidated(segmentKeys.list('v1'))).toBe(true);
  });

  it('stores an updated project', () => {
    const { qc, emit } = setup();
    const project = makeProject({ status: 'confirmed' });
    emit('project.updated', { type: 'project.updated', project });
    expect(qc.getQueryData(projectKeys.one('p1'))).toEqual(project);
  });

  it('forgets a deleted project and navigates home', () => {
    const { qc, emit } = setup();
    qc.setQueryData(projectKeys.all, [{ id: 'p1' }, { id: 'p2' }]);
    emit('project.deleted', { type: 'project.deleted', projectId: 'p1' });
    expect(qc.getQueryData<{ id: string }[]>(projectKeys.all)).toEqual([{ id: 'p2' }]);
    expect(qc.getQueryData(videoKeys.list('p1'))).toBeUndefined();
    expect(currentPath()).toBe('/');
  });

  it('applies export job and clip events to a cached state', () => {
    const { qc, emit } = setup();
    const state: ExportState = { job: job(), clips: [makeClip({ id: 'c1' })], videos: [] };
    qc.setQueryData(exportKeys.state('p1'), state);

    emit('export.updated', { type: 'export.updated', job: job({ progress: 0.7 }) });
    emit('export.clip.updated', {
      type: 'export.clip.updated',
      clip: makeClip({ id: 'c1', approved: true }),
    });
    emit('export.clip.progress', {
      type: 'export.clip.progress',
      clipId: 'c1',
      status: 'cut',
      progress: 0.2,
    });
    const next = qc.getQueryData<ExportState>(exportKeys.state('p1'));
    expect(next?.job.progress).toBe(0.7);
    expect(next?.clips[0]).toMatchObject({ approved: true, status: 'cut', progress: 0.2 });
  });

  it('refetches export state when it is not cached, a clip is unknown or the job resets', () => {
    const { qc, emit, invalidated } = setup();
    qc.setQueryData(exportKeys.state('p1'), null);
    emit('export.updated', { type: 'export.updated', job: job() });
    expect(invalidated(exportKeys.state('p1'))).toBe(true);

    qc.setQueryData(exportKeys.state('p1'), { job: job(), clips: [], videos: [] });
    emit('export.clip.updated', { type: 'export.clip.updated', clip: makeClip({ id: 'new' }) });
    expect(invalidated(exportKeys.state('p1'))).toBe(true);

    qc.setQueryData(exportKeys.state('p1'), { job: job(), clips: [], videos: [] });
    emit('export.reset', { type: 'export.reset', projectId: 'p1' });
    expect(invalidated(exportKeys.state('p1'))).toBe(true);
  });

  it('ignores malformed payloads', () => {
    const { qc, emit } = setup();
    const before = qc.getQueryData(videoKeys.list('p1'));
    emit('video.progress', { type: 'video.progress', videoId: 'v1', status: 'nope' });
    expect(qc.getQueryData(videoKeys.list('p1'))).toBe(before);
  });

  it('refetches videos and export state after a reconnect', () => {
    const { qc, emit, invalidated } = setup();
    qc.setQueryData(exportKeys.state('p1'), null);
    emit('open', {});
    expect(invalidated(videoKeys.list('p1'))).toBe(true);
    expect(invalidated(exportKeys.state('p1'))).toBe(true);
  });
});
