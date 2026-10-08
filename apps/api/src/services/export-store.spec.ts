import os from 'node:os';
import path from 'node:path';
import type { ClipRecord, JobRecord } from '@dfs/export-pipeline';
import { openDatabase, type DbHandle } from '../db/client.js';
import { DataPaths } from '../lib/paths.js';
import { EventBus } from './event-bus.js';
import { DrizzleExportStore } from './export-store.js';
import { ProjectService } from './projects.js';
import { VideoService } from './videos.js';

const migrations = path.resolve(import.meta.dirname, '../../drizzle');

const job = (projectId: string, id = 'j1'): JobRecord => ({
  id,
  projectId,
  manifestPath: '/data/projects/p/manifest.json',
  createdAt: '2024-07-15T10:00:00.000Z',
  buildStatus: 'idle',
  buildError: null,
  archive: null,
  archiveDir: null,
  archiveZip: null,
  archiveHash: null,
});

const clip = (
  videoId: string,
  id: string,
  ordinal: number,
  over: Partial<ClipRecord> = {},
): ClipRecord => ({
  id,
  jobId: 'j1',
  videoId,
  segmentId: `s-${id}`,
  ordinal,
  startSec: 0,
  endSec: 10,
  startFrame: 0,
  endFrame: 300,
  motionType: 'forward',
  status: 'queued',
  progress: 0,
  failedStep: null,
  error: null,
  excluded: false,
  approved: false,
  frames: null,
  geo: null,
  tech: null,
  generation: null,
  metadata: null,
  editorial: null,
  userHint: null,
  poiOverride: null,
  stepHashes: {},
  cutPath: null,
  outputSizeBytes: null,
  filename: null,
  updatedAt: '2024-07-15T10:00:00.000Z',
  ...over,
});

describe('DrizzleExportStore', () => {
  let handle: DbHandle;
  let store: DrizzleExportStore;
  let projectId: string;
  let videoId: string;

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations);
    const bus = new EventBus();
    const paths = new DataPaths(path.join(os.tmpdir(), 'dfs-export-store-unused'));
    projectId = new ProjectService(handle.db, bus, paths).create('Store').id;
    videoId = new VideoService(handle.db, bus, paths).createUploading({
      projectId,
      uploadId: 'u1',
      originalFilename: 'A.MP4',
      sizeBytes: 1,
    }).id;
    store = new DrizzleExportStore(handle.db);
  });
  afterEach(() => {
    handle.close();
  });

  it('creates, finds and updates a job', () => {
    store.createJob(job(projectId));

    expect(store.findJobByProject(projectId)).toEqual(job(projectId));
    expect(store.getJob('j1')).toEqual(job(projectId));
    expect(store.findJobByProject('other')).toBeUndefined();

    const updated = store.updateJob('j1', { buildStatus: 'failed', buildError: 'disk full' });
    expect(updated).toMatchObject({ buildStatus: 'failed', buildError: 'disk full' });
  });

  it('throws 404 when updating an unknown job or clip', () => {
    expect(() => store.updateJob('missing', { buildStatus: 'building' })).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
    expect(() => store.updateClip('missing', { status: 'done' })).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('lists clips by ordinal and round-trips JSON columns', () => {
    store.createJob(job(projectId));
    store.insertClips([
      clip(videoId, 'b', 1),
      clip(videoId, 'a', 0, { stepHashes: { frames: 'h1' }, userHint: 'church' }),
    ]);

    expect(store.listClips('j1').map((c) => c.id)).toEqual(['a', 'b']);
    expect(store.getClip('a')).toMatchObject({ stepHashes: { frames: 'h1' }, userHint: 'church' });
    expect(store.getClip('missing')).toBeUndefined();

    const updated = store.updateClip('b', { status: 'review', progress: 1 });
    expect(updated).toMatchObject({ id: 'b', status: 'review', progress: 1 });
  });

  it('lists only clips still in the middle of processing', () => {
    store.createJob(job(projectId));
    store.insertClips(
      (['queued', 'frames', 'llm', 'cut', 'review', 'done', 'failed'] as const).map((status, i) =>
        clip(videoId, status, i, { status }),
      ),
    );

    expect(
      store
        .listUnfinishedClips()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['cut', 'frames', 'llm', 'queued']);
  });

  it('deletes a job together with its clips', () => {
    store.createJob(job(projectId));
    store.insertClips([clip(videoId, 'a', 0)]);

    store.deleteJob('j1');

    expect(store.getJob('j1')).toBeUndefined();
    expect(store.getClip('a')).toBeUndefined();
  });
});
