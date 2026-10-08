import type { ExistingVideoInfo } from '@dfs/contracts';

interface FakeUpload {
  file: File;
  options: {
    metadata: Record<string, string>;
    onProgress: (sent: number, total: number) => void;
    onSuccess: () => void;
    onError: (err: Error & { originalResponse?: { getBody: () => string } }) => void;
  };
  start: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

const uploads: FakeUpload[] = [];
vi.mock('tus-js-client', () => ({
  Upload: class {
    start = vi.fn();
    abort = vi.fn(() => Promise.resolve());
    resumeFromPreviousUpload = vi.fn();
    findPreviousUploads = () => Promise.resolve([]);
    constructor(
      readonly file: File,
      readonly options: FakeUpload['options'],
    ) {
      uploads.push(this as unknown as FakeUpload);
    }
  },
}));

const fileFingerprint = vi.fn();
vi.mock('./fingerprint', () => ({
  fileFingerprint: (...a: unknown[]) => fileFingerprint(...a),
  readDuration: () => Promise.resolve(12.5),
}));

const checkDuplicates = vi.fn();
vi.mock('../api/videos', () => ({ checkDuplicates: (...a: unknown[]) => checkDuplicates(...a) }));

const existing = { videoId: 'v-old', projectName: 'Alps' } as ExistingVideoInfo;

const flush = () => new Promise((r) => setTimeout(r, 0));
const file = (name: string, content = 'abc') =>
  new File([content], name, { type: 'video/mp4', lastModified: 1 });
const keyOf = (projectId: string, f: File) => `${projectId}:${f.name}:${f.size}:${f.lastModified}`;

// Fresh module per test: the store keeps module-level file maps and p-limit queues.
const loadStore = async () => (await import('./uploadStore')).useUploadStore;

describe('upload store', () => {
  beforeEach(() => {
    vi.resetModules();
    uploads.length = 0;
    fileFingerprint.mockReset().mockResolvedValue('f'.repeat(64));
    checkDuplicates.mockReset().mockResolvedValue({ matches: {} });
  });

  it('fingerprints, checks duplicates and uploads with the fingerprint in metadata', async () => {
    const store = await loadStore();
    const f = file('a.mp4');
    store.getState().addFiles('p1', [f]);
    expect(store.getState().uploads[keyOf('p1', f)].state).toBe('checking');
    await flush();

    expect(checkDuplicates).toHaveBeenCalledWith({
      files: [
        {
          key: keyOf('p1', f),
          filename: 'a.mp4',
          sizeBytes: 3,
          fingerprint: 'f'.repeat(64),
          durationSec: 12.5,
        },
      ],
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].options.metadata).toEqual({
      projectId: 'p1',
      filename: 'a.mp4',
      filetype: 'video/mp4',
      fingerprint: 'f'.repeat(64),
    });
    expect(uploads[0].start).toHaveBeenCalled();
    expect(store.getState().uploads[keyOf('p1', f)].state).toBe('uploading');

    uploads[0].options.onProgress(1, 4);
    expect(store.getState().uploads[keyOf('p1', f)].progress).toBe(0.25);
    uploads[0].options.onSuccess();
    expect(store.getState().uploads[keyOf('p1', f)]).toMatchObject({ state: 'done', progress: 1 });
  });

  it('holds back duplicates until uploadAnyway', async () => {
    const store = await loadStore();
    const f = file('dup.mp4');
    checkDuplicates.mockImplementation(async ({ files }: { files: { key: string }[] }) => ({
      matches: { [files[0].key]: [existing] },
    }));
    store.getState().addFiles('p1', [f]);
    await flush();
    expect(store.getState().uploads[keyOf('p1', f)]).toMatchObject({
      state: 'duplicate',
      duplicates: [existing],
    });
    expect(uploads).toHaveLength(0);

    store.getState().uploadAnyway(keyOf('p1', f));
    await flush();
    expect(uploads).toHaveLength(1);
    expect(store.getState().uploads[keyOf('p1', f)].duplicates).toBeUndefined();
  });

  it('still uploads when fingerprinting or the duplicate check fails', async () => {
    const store = await loadStore();
    fileFingerprint.mockRejectedValueOnce(new Error('unreadable'));
    const a = file('a.mp4');
    store.getState().addFiles('p1', [a]);
    await flush();
    expect(checkDuplicates).not.toHaveBeenCalled();
    expect(uploads[0].options.metadata.fingerprint).toBeUndefined();

    checkDuplicates.mockRejectedValueOnce(new Error('offline'));
    store.getState().addFiles('p1', [file('b.mp4')]);
    await flush();
    expect(uploads).toHaveLength(2);
  });

  it('skips files already being uploaded but re-adds failed ones', async () => {
    const store = await loadStore();
    const f = file('a.mp4');
    store.getState().addFiles('p1', [f]);
    store.getState().addFiles('p1', [f]);
    await flush();
    expect(uploads).toHaveLength(1);

    uploads[0].options.onError(new Error('network down'));
    expect(store.getState().uploads[keyOf('p1', f)]).toMatchObject({
      state: 'error',
      error: 'network down',
    });
    store.getState().addFiles('p1', [f]);
    await flush();
    expect(uploads).toHaveLength(2);
  });

  it('prefers the server response body as the error message and retries', async () => {
    const store = await loadStore();
    const f = file('a.mp4');
    store.getState().addFiles('p1', [f]);
    await flush();
    const err = Object.assign(new Error('tus: failed'), {
      originalResponse: { getBody: () => 'Project is confirmed' },
    });
    uploads[0].options.onError(err);
    expect(store.getState().uploads[keyOf('p1', f)].error).toBe('Project is confirmed');

    store.getState().retry(keyOf('p1', f));
    await flush();
    expect(uploads).toHaveLength(2);
    expect(store.getState().uploads[keyOf('p1', f)]).toMatchObject({
      state: 'uploading',
      error: undefined,
    });
  });

  it('does not start a file dismissed during the check', async () => {
    const store = await loadStore();
    const f = file('a.mp4');
    store.getState().addFiles('p1', [f]);
    store.getState().dismiss(keyOf('p1', f));
    await flush();
    expect(uploads).toHaveLength(0);
    expect(store.getState().uploads).toEqual({});
  });

  it('runs at most 3 uploads in parallel', async () => {
    const store = await loadStore();
    store.getState().addFiles(
      'p1',
      ['1', '2', '3', '4', '5'].map((n) => file(`${n}.mp4`)),
    );
    await flush();
    expect(uploads).toHaveLength(3);
    const waiting = Object.values(store.getState().uploads).filter((u) => u.state === 'waiting');
    expect(waiting).toHaveLength(2);

    uploads[0].options.onSuccess();
    await flush();
    expect(uploads).toHaveLength(4);
  });

  it('cancelProject aborts and forgets only that project uploads', async () => {
    const store = await loadStore();
    store.getState().addFiles('p1', [file('a.mp4')]);
    store.getState().addFiles('p2', [file('b.mp4')]);
    await flush();
    expect(uploads).toHaveLength(2);

    store.getState().cancelProject('p1');
    expect(uploads[0].abort).toHaveBeenCalledWith(false);
    expect(uploads[1].abort).not.toHaveBeenCalled();
    expect(Object.values(store.getState().uploads).map((u) => u.projectId)).toEqual(['p2']);
  });
});
