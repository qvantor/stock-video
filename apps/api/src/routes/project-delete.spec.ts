import fs from 'node:fs';
import path from 'node:path';
import type { Project, Segment } from '@dfs/contracts';
import { createHarness, type TestHarness } from '../test/harness.js';

describe('DELETE /projects/:id', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(() => h.close());

  const createProject = async (name: string) =>
    (
      await h.app.inject({ method: 'POST', url: '/api/projects', payload: { name } })
    ).json<Project>();

  it('removes videos, files, segments, manifest and the project itself', async () => {
    const project = await createProject('to delete');
    const keep = await createProject('keep');

    // A processed video with files on disk and segments.
    const v = h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u-done',
      originalFilename: 'a.mp4',
      sizeBytes: 3,
    });
    const dir = h.services.paths.videoDir(v.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['source.mp4', 'proxy.mp4', 'sprite.jpg', 'features.json']) {
      fs.writeFileSync(path.join(dir, f), 'x');
    }
    h.services.videos.update(v.id, {
      uploadId: null,
      storedPath: path.join(dir, 'source.mp4'),
      status: 'ready',
      durationSec: 60,
      fps: 30,
    });
    const segment: Segment = {
      id: 's1',
      videoId: v.id,
      startSec: 0,
      endSec: 20,
      motionType: 'forward',
      score: 1,
      reasons: [],
      origin: 'ai',
      accepted: true,
      edited: false,
    };
    h.services.segments.replace(v.id, [segment]);

    // An unfinished upload of the same project.
    h.services.videos.createUploading({
      projectId: project.id,
      uploadId: 'u-partial',
      originalFilename: 'b.mp4',
      sizeBytes: 100,
    });
    const partial = path.join(h.services.paths.uploads, 'u-partial');
    fs.writeFileSync(partial, 'xx');
    fs.writeFileSync(`${partial}.json`, '{}');

    // Manifest folder.
    fs.mkdirSync(h.services.paths.projectDir(project.id), { recursive: true });
    fs.writeFileSync(h.services.paths.manifest(project.id), '{}');

    const res = await h.app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
    expect(res.statusCode).toBe(204);

    expect(
      (await h.app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).statusCode,
    ).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: `/api/videos/${v.id}` })).statusCode).toBe(
      404,
    );
    expect(h.services.segments.list(v.id)).toEqual([]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(partial)).toBe(false);
    expect(fs.existsSync(`${partial}.json`)).toBe(false);
    expect(fs.existsSync(h.services.paths.projectDir(project.id))).toBe(false);

    const list = (await h.app.inject({ method: 'GET', url: '/api/projects' })).json<Project[]>();
    expect(list.map((p) => p.id)).toEqual([keep.id]);
  });

  it('returns 404 for an unknown project', async () => {
    expect((await h.app.inject({ method: 'DELETE', url: '/api/projects/nope' })).statusCode).toBe(
      404,
    );
  });
});
