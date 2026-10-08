import fs from 'node:fs';
import {
  SegmentationManifestSchema,
  type ConfirmResponse,
  type Project,
  type ProjectSummary,
  type Segment,
  type SegmentationManifest,
} from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

const seg = (
  videoId: string,
  id: string,
  startSec: number,
  endSec: number,
  extra: Partial<Segment> = {},
): Segment => ({
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
  ...extra,
});

describe('confirmation and manifest', () => {
  let h: TestHarness;
  const received: SegmentationManifest[] = [];
  let project: Project;
  let videoId: string;

  beforeEach(async () => {
    received.length = 0;
    h = await createHarness({
      stage2: { onSegmentsConfirmed: async (m) => void received.push(m) },
    });
    project = (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'p' } })
    ).json<Project>();
    const v = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u1',
      originalFilename: 'DJI_0042.MP4',
      sizeBytes: 1000,
    });
    videoId = v.id;
    h.services.videos.update(videoId, {
      uploadId: null,
      storedPath: '/data/videos/x/source.mp4',
      status: 'ready',
      progress: 1,
      durationSec: 120,
      fps: 29.97,
      width: 3840,
      height: 2160,
      codec: 'hevc',
    });
  });
  afterEach(() => h.close());

  const put = (segments: Segment[]) =>
    h.app.inject({ method: 'PUT', url: `/api/videos/${videoId}/segments`, payload: { segments } });
  const summary = async () =>
    (
      await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}/summary` })
    ).json<ProjectSummary>();

  it('blocks confirmation while segments are invalid', async () => {
    expect((await put([seg(videoId, 'a', 0, 5)])).statusCode).toBe(200);
    const s = await summary();
    expect(s.canConfirm).toBe(false);
    expect(s.issueCount).toBe(1);
    const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    expect(res.statusCode).toBe(409);
  });

  it('writes a frame-rounded manifest with accepted segments only, then locks the project', async () => {
    await put([
      seg(videoId, 'a', 1.01, 21.5),
      seg(videoId, 'b', 30, 70, { accepted: false }),
      seg(videoId, 'c', 80, 110.02, { origin: 'user' }),
    ]);
    expect(await summary()).toMatchObject({
      canConfirm: true,
      acceptedSegments: 2,
      proposedSegments: 3,
    });

    const res = await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` });
    expect(res.statusCode).toBe(200);
    const { manifestPath, manifest } = res.json<ConfirmResponse>();
    expect(manifestPath).toBe(h.services.paths.manifest(project.id));

    const onDisk = SegmentationManifestSchema.parse(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    );
    expect(onDisk).toEqual(manifest);
    expect(received).toEqual([manifest]);
    expect(manifest).toMatchObject({ manifestVersion: 1, projectId: project.id });
    const [video] = manifest.videos;
    expect(video).toMatchObject({ videoId, fps: 29.97, width: 3840, height: 2160 });
    expect(video?.segments.map((s) => s.segmentId)).toEqual(['a', 'c']);
    const a = video?.segments[0];
    expect(a?.startFrame).toBe(Math.round(1.01 * 29.97));
    expect(a?.endFrame).toBe(Math.round(21.5 * 29.97));
    expect(a?.startSec).toBeCloseTo((a?.startFrame ?? 0) / 29.97, 9);
    expect(video?.segments[1]?.origin).toBe('user');

    const p = (
      await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}` })
    ).json<Project>();
    expect(p).toMatchObject({ status: 'confirmed', manifestPath });

    // Read-only afterwards.
    expect((await put([])).statusCode).toBe(409);
    expect(
      (await h.app.inject({ method: 'DELETE', url: `/api/videos/${videoId}` })).statusCode,
    ).toBe(409);
    expect(
      (await h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/confirm` }))
        .statusCode,
    ).toBe(409);
  });

  it('reopens a confirmed project for editing and confirms it again', async () => {
    const reopen = () =>
      h.app.inject({ method: 'POST', url: `/api/projects/${project.id}/reopen` });
    expect((await reopen()).statusCode).toBe(409);

    await put([seg(videoId, 'a', 0, 20)]);
    const first = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/confirm`,
    });
    const { manifestPath } = first.json<ConfirmResponse>();

    const res = await reopen();
    expect(res.statusCode).toBe(200);
    expect(res.json<Project>()).toMatchObject({ status: 'draft', manifestPath: null });
    expect(fs.existsSync(manifestPath)).toBe(false);

    expect((await put([seg(videoId, 'a', 0, 20), seg(videoId, 'b', 40, 60)])).statusCode).toBe(200);
    const second = await h.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/confirm`,
    });
    expect(second.statusCode).toBe(200);
    expect(received).toHaveLength(2);
    expect(received[1]?.videos[0]?.segments.map((s) => s.segmentId)).toEqual(['a', 'b']);
  });

  it('rejects segment sets for another video or with duplicate ids', async () => {
    expect((await put([seg('other', 'a', 0, 20)])).statusCode).toBe(400);
    expect((await put([seg(videoId, 'a', 0, 20), seg(videoId, 'a', 30, 50)])).statusCode).toBe(400);
  });
});
