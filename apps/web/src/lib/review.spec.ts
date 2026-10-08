import { describe, expect, it } from 'vitest';
import type { SourceVideo } from '@dfs/contracts';
import { nextReady, nextVideo, reviewQueue } from './review';

const video = (id: string, patch: Partial<SourceVideo> = {}): SourceVideo => ({
  id,
  projectId: 'p1',
  originalFilename: `${id}.mp4`,
  storedPath: null,
  sizeBytes: 1,
  durationSec: 10,
  fps: 30,
  width: 1920,
  height: 1080,
  codec: 'h264',
  proxyUrl: null,
  spriteUrl: null,
  spriteMeta: null,
  status: 'ready',
  progress: 1,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  reviewed: false,
  duplicateOf: null,
  ...patch,
});

describe('reviewQueue', () => {
  it('keeps ready, unchecked videos in order', () => {
    const list = [
      video('a'),
      video('b', { reviewed: true }),
      video('c', { status: 'analyzing' }),
      video('d', { status: 'failed' }),
      video('e'),
    ];
    expect(reviewQueue(list).map((v) => v.id)).toEqual(['a', 'e']);
  });

  it('is empty when everything is checked', () => {
    expect(reviewQueue([video('a', { reviewed: true })])).toEqual([]);
  });
});

describe('nextVideo', () => {
  it('goes to the first unchecked video, skipping the current one', () => {
    const list = [video('a'), video('b', { reviewed: true }), video('c')];
    expect(nextVideo(list, 'a')?.id).toBe('c');
  });

  it('returns an earlier unchecked video when the current one is later in the list', () => {
    const list = [video('a'), video('b')];
    expect(nextVideo(list, 'b')?.id).toBe('a');
  });

  it('goes to the next ready video in order once everything is checked', () => {
    const list = [
      video('a', { reviewed: true }),
      video('b', { status: 'failed' }),
      video('c', { reviewed: true }),
    ];
    expect(nextVideo(list, 'a')?.id).toBe('c');
  });

  it('returns undefined on the last video when everything is checked', () => {
    const list = [video('a', { reviewed: true }), video('b', { reviewed: true })];
    expect(nextVideo(list, 'b')).toBeUndefined();
  });

  it('returns undefined when the current video is the only unchecked one and last', () => {
    const list = [video('a', { reviewed: true }), video('b')];
    expect(nextVideo(list, 'b')).toBeUndefined();
  });
});

describe('nextReady', () => {
  it('walks ready videos in order regardless of checks', () => {
    const list = [video('a'), video('b', { status: 'analyzing' }), video('c')];
    expect(nextReady(list, 'a')?.id).toBe('c');
    expect(nextReady(list, 'c')).toBeUndefined();
  });
});
