import { validateSegments } from './validation.js';
import type { Segment } from './segment.js';

const seg = (id: string, startSec: number, endSec: number, accepted = true): Segment => ({
  id,
  videoId: 'v',
  startSec,
  endSec,
  motionType: 'forward',
  score: 0.8,
  reasons: [],
  origin: 'ai',
  accepted,
  edited: false,
});

const settings = { minDuration: 10, maxDuration: 50 };

describe('validateSegments', () => {
  it('accepts valid, non-overlapping segments', () => {
    expect(validateSegments([seg('a', 0, 20), seg('b', 20, 45)], settings, 60)).toEqual([]);
  });

  it('flags too short and too long', () => {
    const kinds = validateSegments([seg('a', 0, 5), seg('b', 10, 70)], settings, 100).map(
      (i) => `${i.segmentId}:${i.kind}`,
    );
    expect(kinds).toEqual(['a:too_short', 'b:too_long']);
  });

  it('flags overlaps on both segments', () => {
    const issues = validateSegments([seg('a', 0, 20), seg('b', 15, 35)], settings, 60);
    expect(
      issues
        .filter((i) => i.kind === 'overlap')
        .map((i) => i.segmentId)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('ignores rejected segments', () => {
    expect(validateSegments([seg('a', 0, 3, false), seg('b', 0, 20)], settings, 60)).toEqual([]);
  });

  it('flags segments beyond the video duration', () => {
    expect(validateSegments([seg('a', 50, 65)], settings, 60)[0]?.kind).toBe('out_of_bounds');
  });
});
