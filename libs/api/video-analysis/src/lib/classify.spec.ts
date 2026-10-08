import type { MotionType } from '@dfs/contracts';
import { classifySample } from './classify.js';
import { InProcessAnalyzer } from './inprocess-analyzer.js';
import type { FrameFeatures } from './types.js';
import {
  ascend,
  H,
  iterate,
  noiseFrames,
  orbitRight,
  panLeft,
  panRight,
  renderFrames,
  rotate,
  still,
  tiltUp,
  W,
  zoom,
  zoomAt,
  type Warp,
} from '../test/synth.js';

const FPS = 5;
const N = 16;

const analyze = (frames: Uint8Array[]): Promise<FrameFeatures[]> =>
  new InProcessAnalyzer().analyze(iterate(frames), { width: W, height: H, fps: FPS });

const share = (features: FrameFeatures[], expected: MotionType) =>
  features.filter((f) => classifySample(f) === expected).length / features.length;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('motion classification on synthetic video (opencv-js Farneback)', () => {
  const cases: [string, Warp, MotionType][] = [
    ['texture shift left', panRight(3), 'pan_right'],
    ['texture shift right', panLeft(3), 'pan_left'],
    ['scale up', zoom(1.015), 'forward'],
    ['scale down', zoom(1 / 1.015), 'backward'],
    ['scale up around the upper-left area', zoomAt(1.015, 40, 30), 'forward'],
    ['uniform vertical shift', tiltUp(3), 'tilt_up'],
    ['vertical shift with parallax', ascend(2.5), 'ascend'],
    ['opposite top/bottom shift', orbitRight(2.5), 'orbit_right'],
    ['top-down rotation', rotate(0.012), 'orbit_left'],
    ['no motion', still(), 'static'],
  ];

  it.each(cases)('%s → %s', async (_name, warp, expected) => {
    const features = await analyze(renderFrames(N, warp));
    expect(features).toHaveLength(N - 1);
    expect(share(features, expected)).toBeGreaterThanOrEqual(0.8);
  });

  it('random noise → erratic', async () => {
    const features = await analyze(noiseFrames(N));
    expect(share(features, 'erratic')).toBeGreaterThanOrEqual(0.8);
  });

  it('measures translation speed, zoom and rotation with the right sign and scale', async () => {
    const pan = await analyze(renderFrames(N, panRight(3)));
    // 3 px/frame at 320 px and 5 fps = 0.047 frame widths per second, content moving left.
    expect(mean(pan.map((f) => f.dx))).toBeCloseTo((-3 * FPS) / W, 2);
    expect(Math.abs(mean(pan.map((f) => f.dy)))).toBeLessThan(0.005);
    expect(mean(pan.map((f) => f.fit))).toBeGreaterThan(0.8);
    expect(mean(pan.map((f) => f.coherence))).toBeGreaterThan(0.8);

    const fwd = await analyze(renderFrames(N, zoom(1.015)));
    expect(mean(fwd.map((f) => f.div))).toBeCloseTo(0.015 * FPS, 2);

    const rot = await analyze(renderFrames(N, rotate(0.012)));
    expect(mean(rot.map((f) => f.rot))).toBeCloseTo(0.012 * FPS, 2);
  });

  it('reports sharpness and exposure', async () => {
    const [f] = await analyze(renderFrames(2, still()));
    expect(f?.sharpness).toBeGreaterThan(0);
    expect(f?.brightness).toBeGreaterThan(50);
    expect(f?.brightness).toBeLessThan(200);
    expect(f?.overexposed).toBeLessThan(0.05);
  });
});
