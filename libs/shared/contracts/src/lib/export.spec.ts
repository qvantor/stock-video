import { CLIP_STATUSES } from './clip.js';
import {
  BulkKeywordsBodySchema,
  emptyStatusCounts,
  RegenerateBodySchema,
  VideoLocationBodySchema,
} from './export.js';
import { SegmentSchema } from './segment.js';
import { isVideoSettled, VIDEO_STATUSES } from './video.js';

describe('emptyStatusCounts', () => {
  it('has a zero for every clip status', () => {
    const counts = emptyStatusCounts();
    expect(Object.keys(counts)).toEqual([...CLIP_STATUSES]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('returns a fresh object each time', () => {
    const a = emptyStatusCounts();
    a.done = 5;
    expect(emptyStatusCounts().done).toBe(0);
  });
});

describe('BulkKeywordsBodySchema', () => {
  it('accepts add and remove with a trimmed keyword', () => {
    expect(
      BulkKeywordsBodySchema.parse({ op: 'add', clipIds: ['c1'], keyword: '  drone ' }),
    ).toEqual({ op: 'add', clipIds: ['c1'], keyword: 'drone' });
    expect(BulkKeywordsBodySchema.parse({ op: 'remove', clipIds: ['c1'], keyword: 'x' }).op).toBe(
      'remove',
    );
  });

  it('accepts replace with an empty replacement', () => {
    expect(
      BulkKeywordsBodySchema.parse({ op: 'replace', clipIds: ['c1'], find: 'old', replace: ' ' }),
    ).toEqual({ op: 'replace', clipIds: ['c1'], find: 'old', replace: '' });
  });

  it.each([
    ['an unknown op', { op: 'rename', clipIds: ['c1'], keyword: 'x' }],
    ['no clips', { op: 'add', clipIds: [], keyword: 'x' }],
    ['a blank keyword', { op: 'add', clipIds: ['c1'], keyword: '   ' }],
    ['replace without find', { op: 'replace', clipIds: ['c1'], replace: 'x' }],
    ['add with find instead of keyword', { op: 'add', clipIds: ['c1'], find: 'x' }],
  ])('rejects %s', (_label, body) => {
    expect(BulkKeywordsBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('request bodies', () => {
  it('trims regenerate hints and caps their length', () => {
    expect(RegenerateBodySchema.parse({ hint: ' Kazan Cathedral ' })).toEqual({
      hint: 'Kazan Cathedral',
    });
    expect(RegenerateBodySchema.safeParse({ hint: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accepts a null video location', () => {
    expect(VideoLocationBodySchema.parse({ location: null })).toEqual({ location: null });
    expect(VideoLocationBodySchema.parse({ location: ' Kizhi ' })).toEqual({ location: 'Kizhi' });
  });
});

describe('SegmentSchema', () => {
  const segment = {
    id: 's1',
    videoId: 'v1',
    startSec: 5,
    endSec: 10,
    motionType: 'forward',
    score: 0.5,
    reasons: [],
    origin: 'ai',
    accepted: true,
    edited: false,
  };

  it('accepts a segment whose end is after its start', () => {
    expect(SegmentSchema.safeParse(segment).success).toBe(true);
  });

  it('rejects an empty or reversed range', () => {
    expect(SegmentSchema.safeParse({ ...segment, endSec: 5 }).success).toBe(false);
    expect(SegmentSchema.safeParse({ ...segment, endSec: 4 }).success).toBe(false);
  });

  it('rejects a score outside 0..1', () => {
    expect(SegmentSchema.safeParse({ ...segment, score: 1.2 }).success).toBe(false);
  });
});

describe('isVideoSettled', () => {
  it('is true only for ready and failed', () => {
    expect(VIDEO_STATUSES.filter(isVideoSettled)).toEqual(['ready', 'failed']);
  });
});
