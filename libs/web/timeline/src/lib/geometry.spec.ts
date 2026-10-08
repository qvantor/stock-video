import {
  clampViewport,
  snapTime,
  tickStep,
  timeToX,
  xToTime,
  zoomAt,
  type Viewport,
} from './geometry';

const v: Viewport = { start: 10, pxPerSec: 20, width: 400 };

describe('timeline geometry', () => {
  it('maps time and pixels both ways', () => {
    expect(timeToX(15, v)).toBe(100);
    expect(xToTime(100, v)).toBe(15);
  });

  it('zooms around the anchor', () => {
    const z = zoomAt(v, 2, 100, 600, 30);
    expect(z.pxPerSec).toBe(40);
    expect(xToTime(100, z)).toBeCloseTo(15, 9);
  });

  it('never zooms out beyond the whole video', () => {
    const z = zoomAt(v, 0.001, 0, 60, 30);
    expect(z.pxPerSec).toBeCloseTo(400 / 60, 9);
    expect(z.start).toBe(0);
  });

  it('clamps the viewport to the video', () => {
    expect(clampViewport({ ...v, start: -5 }, 100).start).toBe(0);
    expect(clampViewport({ ...v, start: 95 }, 100).start).toBe(80);
  });

  it('snaps to targets within the threshold, otherwise to frames', () => {
    expect(snapTime(10.2, [10.3], 20, 30)).toEqual({ t: 10.3, snapped: true });
    const r = snapTime(10.2, [11], 20, 30);
    expect(r.snapped).toBe(false);
    expect(r.t * 30).toBeCloseTo(Math.round(10.2 * 30), 9);
  });

  it('chooses readable tick steps', () => {
    expect(tickStep(100)).toBe(1);
    expect(tickStep(10)).toBe(10);
    expect(tickStep(1)).toBe(120);
  });
});
