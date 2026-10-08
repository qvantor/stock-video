import { DEFAULT_ANALYSIS_SETTINGS } from '@dfs/contracts';
import { segmentFeatures, type SegmentSettings } from './segmenter.js';
import type { FrameFeatures } from './types.js';

const FPS = 5;

type Motion = Partial<Pick<FrameFeatures, 'dx' | 'dy' | 'div' | 'rot' | 'px' | 'py' | 'fit'>>;
const PAN: Motion = { dx: -0.05 };
const FORWARD: Motion = { div: 0.08 };
const STATIC: Motion = {};
const ERRATIC: Motion = { dx: 0.03, dy: -0.02, fit: 0.1 };

/** Builds a features timeline from [motion, seconds, overrides?] chunks. */
const timeline = (...chunks: [Motion, number, Partial<FrameFeatures>?][]): FrameFeatures[] => {
  const out: FrameFeatures[] = [];
  for (const [motion, seconds, extra] of chunks) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) {
      out.push({
        t: out.length / FPS,
        dx: 0,
        dy: 0,
        div: 0,
        rot: 0,
        px: 0,
        py: 0,
        fit: 0.95,
        coherence: 0.95,
        magVar: 0.0001,
        sharpness: 500,
        brightness: 120,
        overexposed: 0,
        ...motion,
        ...extra,
      });
    }
  }
  return out;
};

const settings = (s: Partial<SegmentSettings> = {}): SegmentSettings => ({
  ...DEFAULT_ANALYSIS_SETTINGS,
  minDuration: 10,
  maxDuration: 50,
  targetDuration: 25,
  sensitivity: 1,
  ...s,
});
const lengths = (r: ReturnType<typeof segmentFeatures>) =>
  r.segments.map((s) => s.endSec - s.startSec);

describe('segmentFeatures', () => {
  it('turns one smooth run into a trimmed segment with a good score', () => {
    const r = segmentFeatures(timeline([PAN, 30]), FPS, settings());
    expect(r.segments).toHaveLength(1);
    const [s] = r.segments;
    expect(s?.motionType).toBe('pan_right');
    expect(s?.startSec).toBeCloseTo(0.5, 5);
    expect(s?.endSec).toBeCloseTo(29.5, 5);
    expect(s?.score).toBeGreaterThan(0.85);
    expect(s?.reasons[0]).toMatch(/Smooth motion: pan right/);
    expect(r.labels).toHaveLength(150);
    expect(r.speed.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('splits at class changes and drops erratic parts', () => {
    const r = segmentFeatures(timeline([PAN, 25], [ERRATIC, 5], [FORWARD, 25]), FPS, settings());
    expect(r.segments.map((s) => s.motionType)).toEqual(['pan_right', 'forward']);
    expect(r.segments[0]?.endSec).toBeLessThanOrEqual(25);
    expect(r.segments[1]?.startSec).toBeGreaterThanOrEqual(30);
  });

  it('drops runs shorter than minDuration (after trimming)', () => {
    const r = segmentFeatures(timeline([PAN, 10.5], [ERRATIC, 3], [FORWARD, 20]), FPS, settings());
    expect(r.segments.map((s) => s.motionType)).toEqual(['forward']);
  });

  it('splits long runs into pieces within [min, max], close to the target length', () => {
    const r = segmentFeatures(timeline([FORWARD, 121]), FPS, settings());
    const lens = lengths(r);
    expect(lens.length).toBe(5); // 120 s / 25 s target
    for (const l of lens) {
      expect(l).toBeGreaterThanOrEqual(10);
      expect(l).toBeLessThanOrEqual(50);
      expect(Math.abs(l - 24)).toBeLessThan(5);
    }
    // Pieces are contiguous.
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i]?.startSec).toBeCloseTo(r.segments[i - 1]?.endSec ?? 0, 5);
    }
  });

  it('respects custom duration limits', () => {
    const r = segmentFeatures(
      timeline([PAN, 61]),
      FPS,
      settings({ minDuration: 5, maxDuration: 15, targetDuration: 12 }),
    );
    for (const l of lengths(r)) {
      expect(l).toBeGreaterThanOrEqual(5);
      expect(l).toBeLessThanOrEqual(15);
    }
    expect(lengths(r).reduce((a, b) => a + b, 0)).toBeCloseTo(60, 0);
  });

  it('keeps hovering shots only when includeStatic is on', () => {
    const f = timeline([STATIC, 20]);
    expect(segmentFeatures(f, FPS, settings()).segments).toHaveLength(0);
    const r = segmentFeatures(f, FPS, settings({ includeStatic: true }));
    expect(r.segments.map((s) => s.motionType)).toEqual(['static']);
  });

  it('merges short label flicker inside a run', () => {
    // 1 s of parallax makes a few samples look like an orbit; the mode filter alone keeps them.
    const blip = { dx: -0.012, px: 0.05 };
    const r = segmentFeatures(timeline([PAN, 15], [blip, 1], [PAN, 15]), FPS, settings());
    expect(r.labels.filter((l) => l === 'orbit_right').length).toBeGreaterThan(0);
    expect(r.segments).toHaveLength(1);
    expect(lengths(r)[0]).toBeCloseTo(30, 5);
  });

  it('cuts at blurred and over-exposed samples', () => {
    const blurred = segmentFeatures(
      timeline([PAN, 20], [PAN, 2, { sharpness: 20 }], [PAN, 20]),
      FPS,
      settings(),
    );
    expect(blurred.segments).toHaveLength(2);
    const clipped = segmentFeatures(
      timeline([PAN, 20], [PAN, 2, { overexposed: 0.5, brightness: 245 }], [PAN, 20]),
      FPS,
      settings(),
    );
    expect(clipped.segments).toHaveLength(2);
  });

  it('cuts where the speed changes sharply even if the class stays the same', () => {
    const r = segmentFeatures(timeline([{ dx: -0.03 }, 20], [{ dx: -0.12 }, 20]), FPS, settings());
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]?.endSec).toBeLessThanOrEqual(20.5);
    expect(r.segments[1]?.startSec).toBeGreaterThanOrEqual(19.5);
  });

  it('keeps a mild jerk inside the segment but mentions it and lowers the score', () => {
    const smooth = segmentFeatures(timeline([PAN, 30]), FPS, settings());
    const jerky = segmentFeatures(
      timeline([PAN, 14], [{ dx: -0.075 }, 0.2], [PAN, 16]),
      FPS,
      settings(),
    );
    expect(jerky.segments).toHaveLength(1);
    expect(jerky.segments[0]?.reasons.some((r) => /Slight jerk at 00:14/.test(r))).toBe(true);
    expect(jerky.segments[0]?.score ?? 1).toBeLessThan(smooth.segments[0]?.score ?? 0);
  });

  it('higher sensitivity is stricter about smoothness', () => {
    const wobbly = timeline([{ dx: -0.05, fit: 0.6 }, 20]);
    expect(segmentFeatures(wobbly, FPS, settings({ sensitivity: 1 })).segments).toHaveLength(1);
    expect(segmentFeatures(wobbly, FPS, settings({ sensitivity: 2 })).segments).toHaveLength(0);
  });
});
