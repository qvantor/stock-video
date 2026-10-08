import type { Segment } from '@dfs/contracts';
import {
  createSegment,
  mergeSegments,
  removeSegments,
  segmentAt,
  setBounds,
  setMotionType,
  splitAt,
  toggleAccept,
} from './segmentOps';

const seg = (
  id: string,
  startSec: number,
  endSec: number,
  extra: Partial<Segment> = {},
): Segment => ({
  id,
  videoId: 'v',
  startSec,
  endSec,
  motionType: 'forward',
  score: 0.8,
  reasons: ['r'],
  origin: 'ai',
  accepted: true,
  edited: false,
  ...extra,
});

describe('segment operations', () => {
  it('creates a user segment snapped to frames, sorted', () => {
    const { list, id } = createSegment([seg('a', 20, 30)], 'v', 12.01, 5.02, 30);
    expect(list.map((s) => s.id)).toEqual([id, 'a']);
    expect(list[0]).toMatchObject({ origin: 'user', accepted: true, edited: false });
    expect((list[0]?.startSec ?? 0) * 30).toBeCloseTo(Math.round(5.02 * 30), 9);
  });

  it('changes bounds, clamps to duration and marks AI segments as edited', () => {
    const list = setBounds([seg('a', 0, 10)], [{ id: 'a', startSec: 2, endSec: 99 }], 25, 60);
    expect(list[0]).toMatchObject({ startSec: 2, endSec: 60, edited: true });
  });

  it('toggles acceptance as a group', () => {
    const list = [seg('a', 0, 10), seg('b', 10, 20, { accepted: false })];
    const once = toggleAccept(list, new Set(['a', 'b']));
    expect(once.every((s) => s.accepted)).toBe(true);
    expect(toggleAccept(once, new Set(['a', 'b'])).every((s) => !s.accepted)).toBe(true);
  });

  it('splits at a frame inside the segment', () => {
    const r = splitAt([seg('a', 0, 20)], 'a', 7.5, 30);
    expect(r?.list.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 7.5],
      [7.5, 20],
    ]);
    expect(r?.list.every((s) => s.edited)).toBe(true);
    expect(splitAt([seg('a', 0, 20)], 'a', 20, 30)).toBeNull();
  });

  it('merges into one spanning segment with length-weighted score', () => {
    const r = mergeSegments(
      [seg('a', 0, 10, { score: 1 }), seg('b', 10, 40, { score: 0.6, motionType: 'pan_left' })],
      new Set(['a', 'b']),
    );
    expect(r?.list).toHaveLength(1);
    expect(r?.list[0]).toMatchObject({
      startSec: 0,
      endSec: 40,
      motionType: 'pan_left',
      score: 0.7,
    });
    expect(mergeSegments([seg('a', 0, 10)], new Set(['a']))).toBeNull();
  });

  it('removes and retypes', () => {
    const list = [seg('a', 0, 10), seg('b', 10, 20)];
    expect(removeSegments(list, new Set(['a'])).map((s) => s.id)).toEqual(['b']);
    expect(setMotionType(list, new Set(['b']), 'orbit_left')[1]).toMatchObject({
      motionType: 'orbit_left',
      edited: true,
    });
  });
});

describe('segmentAt', () => {
  it('picks the shortest segment under the playhead', () => {
    const list = [seg('long', 0, 30), seg('short', 5, 10)];
    expect(segmentAt(list, 7)?.id).toBe('short');
    expect(segmentAt(list, 2)?.id).toBe('long');
  });

  it('treats the end bound as exclusive', () => {
    const list = [seg('a', 0, 10), seg('b', 10, 20)];
    expect(segmentAt(list, 10)?.id).toBe('b');
    expect(segmentAt(list, 20)).toBeUndefined();
    expect(segmentAt([], 1)).toBeUndefined();
  });
});
