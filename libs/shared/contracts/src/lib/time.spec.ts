import { formatTimecode, parseTimecode, secToFrame, snapToFrame } from './time.js';

describe('time helpers', () => {
  it('snaps to the nearest frame', () => {
    expect(snapToFrame(1.01, 30)).toBeCloseTo(1, 6);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(31 / 30, 6);
    expect(secToFrame(10.5, 29.97)).toBe(315);
  });

  it('formats and parses timecodes', () => {
    expect(formatTimecode(75.25)).toBe('01:15.25');
    expect(formatTimecode(3725)).toBe('1:02:05.00');
    expect(parseTimecode('01:15.25')).toBeCloseTo(75.25);
    expect(parseTimecode('1:02:05')).toBe(3725);
    expect(parseTimecode('12.5')).toBe(12.5);
    expect(parseTimecode('ab')).toBeNull();
  });
});
