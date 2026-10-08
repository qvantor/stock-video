import fs from 'node:fs';
import path from 'node:path';
import type { MediaInfo, ProbeResult } from '@dfs/ffmpeg';
import type { SpriteMeta } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import type { MediaTools } from './media.js';
import { ProcessingQueue, type VideoAnalysisStep } from './processing.js';

const probe: ProbeResult = { durationSec: 12, fps: 30, width: 1920, height: 1080, codec: 'h264' };
const mediaInfo: MediaInfo = {
  ...probe,
  pixFmt: 'yuv420p',
  bitDepth: 8,
  colorTransfer: 'rec709',
  hasAudio: false,
  creationTime: '2024-07-15T10:00:00.000000Z',
  location: null,
  make: null,
  model: null,
  tags: {},
  djiMetaStream: null,
};
const spriteMeta: SpriteMeta = {
  interval: 2,
  tileWidth: 160,
  tileHeight: 90,
  columns: 10,
  rows: 1,
  count: 6,
};

const fakeMedia = () => ({
  probe: vi.fn(async () => probe),
  probeDetailed: vi.fn(async () => mediaInfo),
  makeProxy: vi.fn(
    async (_src: string, _dest: string, _d: number, onProgress: (f: number) => void) => {
      onProgress(0.5);
    },
  ),
  makeSprite: vi.fn(async () => spriteMeta),
});

/** Analysis step that waits until released (or aborted). */
const gatedAnalysis = () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const step: VideoAnalysisStep = {
    analyze: vi.fn(
      (_id: string, onProgress: (f: number) => void, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          onProgress(0.5);
          signal.addEventListener('abort', () => reject(signal.reason));
          void gate.then(resolve);
        }),
    ),
  };
  return { step, release };
};

describe('ProcessingQueue', () => {
  let h: TestHarness;
  let projectId: string;
  let media: ReturnType<typeof fakeMedia>;

  beforeEach(async () => {
    h = await createHarness();
    projectId = h.services.projects.create('Queue').id;
    media = fakeMedia();
  });
  afterEach(async () => {
    await h.close();
  });

  const makeQueue = (analysis: VideoAnalysisStep, concurrency = 1) =>
    new ProcessingQueue(
      concurrency,
      h.services.videos,
      media as unknown as MediaTools,
      analysis,
      h.services.paths,
      h.app.log.child({}, { level: 'silent' }),
    );

  /** A stored source file with deterministic content. */
  const seedVideo = (name = 'DJI_0001.MP4', content = 'source-bytes', createdAt?: string) => {
    if (createdAt) vi.useFakeTimers({ toFake: ['Date'], now: new Date(createdAt) });
    const video = h.services.videos.createUploading({
      projectId,
      uploadId: `u-${name}-${Math.random()}`,
      originalFilename: name,
      sizeBytes: Buffer.byteLength(content),
    });
    vi.useRealTimers();
    const dir = h.services.paths.videoDir(video.id);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, 'source.mp4');
    fs.writeFileSync(storedPath, content);
    h.services.videos.update(video.id, { storedPath, status: 'queued' });
    return video.id;
  };

  it('runs probe → proxy → sprite → analysis and marks the video ready', async () => {
    const analysis: VideoAnalysisStep = { analyze: vi.fn(async () => undefined) };
    const queue = makeQueue(analysis);
    const id = seedVideo();
    const statuses: string[] = [];
    h.services.bus.subscribe(projectId, (e) => {
      if (e.type === 'video.updated' && e.video.id === id) statuses.push(e.video.status);
    });

    queue.enqueue(id);
    await queue.onIdle();

    const row = h.services.videos.getRow(id);
    expect(row.status).toBe('ready');
    expect(row.progress).toBe(1);
    expect(row.durationSec).toBe(12);
    expect(row.hasProxy).toBe(true);
    expect(row.spriteMeta).toEqual(spriteMeta);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row.mediaInfo).toEqual(mediaInfo);
    expect(analysis.analyze).toHaveBeenCalledWith(
      id,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(media.makeProxy).toHaveBeenCalledWith(
      row.storedPath,
      h.services.paths.proxy(id),
      12,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    for (const s of ['queued', 'probing', 'proxy', 'analyzing', 'ready']) {
      expect(statuses).toContain(s);
    }
  });

  it('skips the proxy and sprite when both already exist', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const id = seedVideo();
    h.services.videos.update(id, { hasProxy: true, spriteMeta });

    queue.enqueue(id);
    await queue.onIdle();

    expect(media.makeProxy).not.toHaveBeenCalled();
    expect(media.makeSprite).not.toHaveBeenCalled();
    expect(h.services.videos.getRow(id).status).toBe('ready');
  });

  it('marks the video failed with the error message when a step throws', async () => {
    const queue = makeQueue({
      analyze: async () => {
        throw new Error('analysis exploded');
      },
    });
    const id = seedVideo();

    queue.enqueue(id);
    await queue.onIdle();

    const row = h.services.videos.getRow(id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('analysis exploded');
  });

  it('fails when the stored source file is missing', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const id = seedVideo();
    fs.rmSync(h.services.videos.getRow(id).storedPath as string);

    queue.enqueue(id);
    await queue.onIdle();

    expect(h.services.videos.getRow(id).status).toBe('failed');
    expect(media.probe).not.toHaveBeenCalled();
  });

  it('fails without a stored path', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const id = seedVideo();
    h.services.videos.update(id, { storedPath: null });

    queue.enqueue(id);
    await queue.onIdle();

    const row = h.services.videos.getRow(id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('The source file is missing');
  });

  it('ignores a second enqueue of a pending or running video', async () => {
    const { step, release } = gatedAnalysis();
    const queue = makeQueue(step);
    const id = seedVideo();

    queue.enqueue(id);
    queue.enqueue(id);
    await vi.waitFor(() => expect(step.analyze).toHaveBeenCalledTimes(1));
    queue.enqueue(id);
    release();
    await queue.onIdle();

    expect(step.analyze).toHaveBeenCalledTimes(1);
    expect(media.probe).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued video before it starts', async () => {
    const { step, release } = gatedAnalysis();
    const queue = makeQueue(step);
    const first = seedVideo('A.MP4', 'aaa');
    const second = seedVideo('B.MP4', 'bbb');

    queue.enqueue(first);
    queue.enqueue(second);
    await queue.cancel(second);
    release();
    await queue.onIdle();

    expect(step.analyze).toHaveBeenCalledTimes(1);
    expect(h.services.videos.getRow(first).status).toBe('ready');
    expect(h.services.videos.getRow(second).status).toBe('queued');
  });

  it('aborts a running video without marking it failed', async () => {
    const { step } = gatedAnalysis();
    const queue = makeQueue(step);
    const id = seedVideo();

    queue.enqueue(id);
    await vi.waitFor(() => expect(step.analyze).toHaveBeenCalled());
    await queue.cancel(id);
    await queue.onIdle();

    const row = h.services.videos.getRow(id);
    expect(row.status).toBe('analyzing');
    expect(row.error).toBeNull();
  });

  it('does not mark a video failed when its row was deleted mid-run', async () => {
    const queue = makeQueue({
      analyze: async (videoId) => {
        h.services.videos.remove(videoId);
        throw new Error('file vanished');
      },
    });
    const id = seedVideo();

    queue.enqueue(id);
    await queue.onIdle();

    expect(h.services.videos.findRow(id)).toBeUndefined();
  });

  it('resumes only interrupted videos that have a stored file', async () => {
    const analysis: VideoAnalysisStep = { analyze: vi.fn(async () => undefined) };
    const queue = makeQueue(analysis);
    const withFile = seedVideo('A.MP4', 'aaa');
    h.services.videos.update(withFile, { status: 'analyzing' });
    const withoutFile = seedVideo('B.MP4', 'bbb');
    h.services.videos.update(withoutFile, { status: 'proxy', storedPath: null });
    const settled = seedVideo('C.MP4', 'ccc');
    h.services.videos.update(settled, { status: 'ready' });

    queue.resumeInterrupted();
    await queue.onIdle();

    expect(analysis.analyze).toHaveBeenCalledTimes(1);
    expect(analysis.analyze).toHaveBeenCalledWith(
      withFile,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(h.services.videos.getRow(withoutFile).status).toBe('proxy');
    expect(h.services.videos.getRow(settled).status).toBe('ready');
  });

  it('links a re-uploaded identical file to the earlier video', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const original = seedVideo('A.MP4', 'same-content', '2024-01-01T00:00:00.000Z');
    const copy = seedVideo('B.MP4', 'same-content', '2024-01-02T00:00:00.000Z');
    const other = seedVideo('C.MP4', 'other-content', '2024-01-03T00:00:00.000Z');

    queue.enqueue(original);
    queue.enqueue(copy);
    queue.enqueue(other);
    await queue.onIdle();

    expect(h.services.videos.getRow(original).duplicateOfId).toBeNull();
    expect(h.services.videos.getRow(copy).duplicateOfId).toBe(original);
    expect(h.services.videos.getRow(other).duplicateOfId).toBeNull();
    expect(h.services.videos.get(copy).duplicateOf).toMatchObject({
      videoId: original,
      projectId,
      originalFilename: 'A.MP4',
    });
  });

  it('backfills hashes and metadata of settled videos stored without them', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const id = seedVideo();
    h.services.videos.update(id, { status: 'ready', ...probe });

    queue.backfillHashes();
    await queue.onIdle();

    const row = h.services.videos.getRow(id);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row.mediaInfo).toEqual(mediaInfo);
    expect(row.status).toBe('ready');
    expect(media.probe).not.toHaveBeenCalled();
  });

  it('keeps going when backfilling a video fails', async () => {
    const queue = makeQueue({ analyze: async () => undefined });
    const id = seedVideo();
    h.services.videos.update(id, { status: 'failed' });
    media.probeDetailed.mockRejectedValueOnce(new Error('probe failed'));

    queue.backfillHashes();
    await expect(queue.onIdle()).resolves.toBeUndefined();

    expect(h.services.videos.getRow(id).mediaInfo).toBeNull();
  });
});
