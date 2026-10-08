import fs from 'node:fs';
import path from 'node:path';
import type {
  ClipStep,
  ExportState,
  Project,
  Segment,
  StorageCleanupResult,
  StorageUsage,
} from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';
import { fakeExportSteps } from '../test/export-fakes.js';

const seg = (videoId: string, id: string, startSec: number, endSec: number): Segment => ({
  id,
  videoId,
  startSec,
  endSec,
  motionType: 'orbit_left',
  score: 0.9,
  reasons: [],
  origin: 'ai',
  accepted: true,
  edited: false,
});

const write = (p: string, bytes: number) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
};

describe('storage API', () => {
  let h: TestHarness;
  let project: Project;
  let videoId: string;
  let runs: Record<ClipStep, number>;

  beforeEach(async () => {
    runs = { frames: 0, geo: 0, tech: 0, llm: 0, cut: 0 };
    h = await createHarness({ exportSteps: fakeExportSteps(runs) });
    project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kizhi' } })
    ).json<Project>();
    videoId = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u1',
      originalFilename: 'DJI_0042.MP4',
      sizeBytes: 1000,
    }).id;
    const dir = h.services.paths.videoDir(videoId);
    write(path.join(dir, 'source.mp4'), 1000);
    write(path.join(dir, 'proxy.mp4'), 300);
    write(path.join(dir, 'sprite.jpg'), 20);
    write(path.join(dir, 'features.json'), 5);
    h.services.videos.update(videoId, {
      uploadId: null,
      storedPath: path.join(dir, 'source.mp4'),
      status: 'ready',
      progress: 1,
      durationSec: 120,
      fps: 30,
      width: 3840,
      height: 2160,
      codec: 'hevc',
      mediaInfo: {
        durationSec: 120,
        fps: 30,
        width: 3840,
        height: 2160,
        codec: 'hevc',
        pixFmt: 'yuv420p10le',
        bitDepth: 10,
        colorTransfer: 'rec709',
        hasAudio: false,
        creationTime: null,
        location: null,
        make: 'DJI',
        model: null,
        tags: {},
        djiMetaStream: null,
      },
    });
    await h.app.inject({
      method: 'PUT',
      url: `/api/videos/${videoId}/segments`,
      payload: { segments: [seg(videoId, 'a', 0, 20), seg(videoId, 'b', 40, 60)] },
    });
  });
  afterEach(() => h.close());

  const getUsage = async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/storage' });
    expect(res.statusCode).toBe(200);
    return res.json<StorageUsage>();
  };
  const getState = async () =>
    (
      await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/export` })
    ).json<ExportState>();

  /** Confirm, approve and cut both clips, with real files in export-work and an archive. */
  const exportAll = async () => {
    const confirm = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/confirm`,
    });
    expect(confirm.statusCode).toBe(200);
    await h.services.exports.pipeline.onIdle();
    const ids = (await getState()).clips.map((c) => c.id);
    await h.app.inject({ method: 'POST', url: '/api/clips/approve', payload: { clipIds: ids } });
    await h.services.exports.pipeline.onIdle();

    const { paths } = h.services;
    const job = h.services.exports.getJob(project.id);
    const archiveDir = path.join(paths.exportsRoot, 'export_kizhi');
    const archiveZip = `${archiveDir}.zip`;
    for (const id of ids) {
      const work = paths.clipWork(job.id, id);
      const cutPath = path.join(work, 'cut.mov');
      write(cutPath, 4000);
      write(path.join(work, 'frame_0.jpg'), 50);
      // The archive hard-links the encoded clip.
      fs.mkdirSync(path.join(archiveDir, 'videos'), { recursive: true });
      fs.linkSync(cutPath, path.join(archiveDir, 'videos', `${id}.mov`));
      h.services.exports.pipeline.update(id, { cutPath, outputSizeBytes: 4000 });
      write(path.join(paths.llmLogs, `${id}_2026-01-01_a1.json`), 70);
    }
    write(path.join(archiveDir, 'metadata.json'), 30);
    write(archiveZip, 8000);
    h.services.exports['d'].store.updateJob(job.id, {
      buildStatus: 'built',
      archiveDir,
      archiveZip,
      archiveHash: 'h',
    });
    return { ids, job, archiveDir, archiveZip };
  };

  it('reports usage by type and project, counting hard links once', async () => {
    await exportAll();
    // Leftovers of a deleted export job.
    write(path.join(h.services.paths.exportWork('gone'), 'c', 'cut.mov'), 500);

    const usage = await getUsage();
    const [p] = usage.projects;
    expect(p).toMatchObject({ id: project.id, name: 'Kizhi' });
    expect(p!.byCategory).toMatchObject({
      sources: 1000,
      proxies: 320,
      encodedClips: 8000,
      frames: 100,
      archives: 8030,
      aiLogs: 140,
    });
    // features.json plus the telemetry cache written by the export.
    expect(p!.byCategory.analysis).toBeGreaterThanOrEqual(5);
    expect(p!.reclaimableBytes).toBe(16030);
    expect(usage.unassigned.byCategory.encodedClips).toBe(500);
    expect(usage.unassigned.reclaimableBytes).toBe(500);
    expect(usage.reclaimableBytes).toBe(16530);
    expect(usage.totalBytes).toBe(p!.totalBytes + usage.unassigned.totalBytes);
  });

  it('cleanup deletes encoded files and archives but keeps metadata, frames and AI logs', async () => {
    const { ids, job, archiveDir, archiveZip } = await exportAll();
    const orphan = path.join(h.services.paths.exportWork('gone'), 'c', 'cut.mov');
    write(orphan, 500);

    const res = await h.app.inject({ method: 'POST', url: '/api/storage/cleanup' });
    expect(res.statusCode).toBe(200);
    expect(res.json<StorageCleanupResult>()).toEqual({
      freedBytes: 16530,
      jobsCleaned: 1,
      clipsReset: 2,
      skipped: [],
    });

    expect(fs.existsSync(archiveDir)).toBe(false);
    expect(fs.existsSync(archiveZip)).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
    for (const id of ids) {
      const work = h.services.paths.clipWork(job.id, id);
      expect(fs.existsSync(path.join(work, 'cut.mov'))).toBe(false);
      expect(fs.existsSync(path.join(work, 'frame_0.jpg'))).toBe(true);
    }
    expect(fs.readdirSync(h.services.paths.llmLogs)).toHaveLength(2);
    expect(fs.existsSync(path.join(h.services.paths.videoDir(videoId), 'proxy.mp4'))).toBe(true);

    const state = await getState();
    expect(state.job).toMatchObject({ buildStatus: 'idle', archive: null, canBuild: false });
    for (const clip of state.clips) {
      expect(clip).toMatchObject({ status: 'review', approved: true });
      expect(clip.metadata?.title).toBeTruthy();
    }
    expect((await getUsage()).reclaimableBytes).toBe(0);

    // Starting the export again re-encodes the approved clips.
    await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/export` });
    await h.services.exports.pipeline.onIdle();
    expect((await getState()).clips.map((c) => c.status)).toEqual(['done', 'done']);
    expect(runs.llm).toBe(2);
  });

  it('skips a job whose archive is being built', async () => {
    const { job, archiveZip } = await exportAll();
    h.services.exports['d'].store.updateJob(job.id, { buildStatus: 'building' });

    const result = (
      await h.app.inject({ method: 'POST', url: '/api/storage/cleanup' })
    ).json<StorageCleanupResult>();
    expect(result).toMatchObject({ freedBytes: 0, jobsCleaned: 0, clipsReset: 0 });
    expect(result.skipped).toEqual([
      { projectId: project.id, reason: 'The archive is being built' },
    ]);
    expect(fs.existsSync(archiveZip)).toBe(true);
  });

  it('refuses a second cleanup while one is running', async () => {
    await exportAll();
    const [first, second] = await Promise.all([
      h.app.inject({ method: 'POST', url: '/api/storage/cleanup' }),
      h.app.inject({ method: 'POST', url: '/api/storage/cleanup' }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const rejected = first.statusCode === 409 ? first : second;
    expect(rejected.json<{ error: string }>().error).toBe('A cleanup is already running');
  });
});
