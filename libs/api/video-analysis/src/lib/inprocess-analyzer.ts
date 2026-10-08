import { FrameAnalyzer } from './frame-analyzer.js';
import { loadOpenCv } from './opencv.js';
import type { AnalyzeOptions, FrameFeatures, FrameSourceInfo, MotionAnalyzer } from './types.js';

/** Same analysis on the calling thread (tests, scripts). */
export class InProcessAnalyzer implements MotionAnalyzer {
  async analyze(
    frames: AsyncIterable<Uint8Array>,
    info: FrameSourceInfo,
    opts: AnalyzeOptions = {},
  ): Promise<FrameFeatures[]> {
    const cv = await loadOpenCv();
    const analyzer = new FrameAnalyzer(cv, info.width, info.height, info.fps);
    const out: FrameFeatures[] = [];
    let n = 0;
    try {
      for await (const frame of frames) {
        opts.signal?.throwIfAborted();
        const f = analyzer.push(frame);
        if (f) out.push(f);
        n++;
        if (info.expectedFrames) opts.onProgress?.(Math.min(0.99, n / info.expectedFrames));
      }
    } finally {
      analyzer.dispose();
    }
    opts.onProgress?.(1);
    return out;
  }
}
