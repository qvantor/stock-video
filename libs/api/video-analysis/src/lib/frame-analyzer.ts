import { ANALYSIS_CONFIG } from './config.js';
import { computeExposure, computeFlowStats } from './flow-stats.js';
import type { CV } from './opencv.js';
import type { FrameFeatures } from './types.js';

type Mat = InstanceType<CV['Mat']>;

/**
 * Stateful per-stream analyser: feed consecutive grayscale frames, get the
 * features of each consecutive pair (dense Farneback flow + sharpness + exposure).
 */
export class FrameAnalyzer {
  private prev: Mat;
  private cur: Mat;
  private readonly flow: Mat;
  private readonly lap: Mat;
  private readonly mean: Mat;
  private readonly std: Mat;
  private index = 0;

  constructor(
    private readonly cv: CV,
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
    private readonly cfg = ANALYSIS_CONFIG.flow,
  ) {
    this.prev = new cv.Mat(height, width, cv.CV_8UC1);
    this.cur = new cv.Mat(height, width, cv.CV_8UC1);
    this.flow = new cv.Mat();
    this.lap = new cv.Mat();
    this.mean = new cv.Mat();
    this.std = new cv.Mat();
  }

  /** Returns features for (previous, this) frame, or null for the very first frame. */
  push(frame: Uint8Array): FrameFeatures | null {
    if (frame.length !== this.width * this.height) {
      throw new Error(`frame size ${frame.length} != ${this.width}x${this.height}`);
    }
    this.cur.data.set(frame);
    const i = this.index++;
    if (i === 0) {
      this.swap();
      return null;
    }
    const { cv, cfg } = this;
    cv.calcOpticalFlowFarneback(
      this.prev,
      this.cur,
      this.flow,
      cfg.pyrScale,
      cfg.levels,
      cfg.winSize,
      cfg.iterations,
      cfg.polyN,
      cfg.polySigma,
      0,
    );
    const stats = computeFlowStats(this.flow.data32F, this.width, this.height, this.fps, cfg);

    cv.Laplacian(this.cur, this.lap, cv.CV_64F, 1, 1, 0, cv.BORDER_DEFAULT);
    cv.meanStdDev(this.lap, this.mean, this.std);
    const sd = this.std.data64F[0] ?? 0;
    const exposure = computeExposure(frame, cfg.clipLuma);

    this.swap();
    return { t: (i - 1) / this.fps, ...stats, sharpness: sd * sd, ...exposure };
  }

  dispose(): void {
    for (const m of [this.prev, this.cur, this.flow, this.lap, this.mean, this.std]) m.delete();
  }

  private swap(): void {
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
  }
}
