import { ProjectEventSchema } from './events.js';

const video = {
  id: 'v1',
  projectId: 'p1',
  originalFilename: 'DJI_0001.MP4',
  storedPath: null,
  sizeBytes: 10,
  durationSec: null,
  fps: null,
  width: null,
  height: null,
  codec: null,
  proxyUrl: null,
  spriteUrl: null,
  spriteMeta: null,
  status: 'queued',
  progress: 0,
  error: null,
  createdAt: '2024-07-15T10:00:00.000Z',
  reviewed: false,
  duplicateOf: null,
};

describe('ProjectEventSchema', () => {
  it.each([
    { type: 'video.progress', videoId: 'v1', status: 'proxy', progress: 0.4 },
    { type: 'video.updated', video },
    { type: 'video.deleted', videoId: 'v1' },
    { type: 'segments.updated', videoId: 'v1' },
    { type: 'project.deleted', projectId: 'p1' },
    { type: 'export.reset', projectId: 'p1' },
    { type: 'export.clip.progress', clipId: 'c1', status: 'llm', progress: 0.5 },
  ])('accepts a valid $type event', (event) => {
    expect(ProjectEventSchema.parse(event)).toEqual(event);
  });

  it('rejects an unknown event type', () => {
    expect(ProjectEventSchema.safeParse({ type: 'video.renamed', videoId: 'v1' }).success).toBe(
      false,
    );
  });

  it('rejects a payload that does not match its type', () => {
    expect(ProjectEventSchema.safeParse({ type: 'video.deleted' }).success).toBe(false);
    expect(
      ProjectEventSchema.safeParse({
        type: 'video.progress',
        videoId: 'v1',
        status: 'exploding',
        progress: 0.4,
      }).success,
    ).toBe(false);
    expect(
      ProjectEventSchema.safeParse({ type: 'video.updated', video: { ...video, status: 'nope' } })
        .success,
    ).toBe(false);
  });
});
