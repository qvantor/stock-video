import { Worker } from 'node:worker_threads';
import type { AnalyzeOptions, FrameFeatures, FrameSourceInfo, MotionAnalyzer } from './types.js';
import { FLOW_WORKER_ROLE } from './flow-worker.js';
import type { FromWorker, ToWorker } from './worker-protocol.js';

/** Max frames sent to the worker but not yet processed (bounds memory). */
const MAX_IN_FLIGHT = 8;

/**
 * MotionAnalyzer running opencv-js Farneback flow inside a worker thread, so the
 * API event loop stays responsive. One worker per analysis.
 *
 * `entryScript` is a JS file that calls `runFlowWorker()` when
 * `isFlowWorkerThread()` is true (the bundled API uses its own main.js).
 */
export class OpencvWorkerAnalyzer implements MotionAnalyzer {
  constructor(private readonly entryScript: string | URL) {}

  async analyze(
    frames: AsyncIterable<Uint8Array>,
    info: FrameSourceInfo,
    opts: AnalyzeOptions = {},
  ): Promise<FrameFeatures[]> {
    const worker = new Worker(this.entryScript, { workerData: { role: FLOW_WORKER_ROLE } });
    const features: FrameFeatures[] = [];
    let processed = 0;
    let failure: Error | null = null;
    let wake: (() => void) | null = null;
    let doneResolve: (() => void) | null = null;
    const done = new Promise<void>((r) => (doneResolve = r));
    const ready = new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (msg: FromWorker) => {
        switch (msg.type) {
          case 'ready':
            resolve();
            break;
          case 'features':
            processed++;
            if (msg.features) features.push(msg.features);
            if (info.expectedFrames)
              opts.onProgress?.(Math.min(0.99, processed / info.expectedFrames));
            break;
          case 'done':
            doneResolve?.();
            break;
          case 'error':
            failure = new Error(`Motion analysis: ${msg.message}`);
            reject(failure);
            doneResolve?.();
            break;
        }
        wake?.();
      });
    });
    worker.on('error', (err) => {
      failure ??= err;
      doneResolve?.();
      wake?.();
    });

    const send = (msg: ToWorker, transfer: ArrayBuffer[] = []) => worker.postMessage(msg, transfer);
    try {
      send({ type: 'init', width: info.width, height: info.height, fps: info.fps });
      await ready;
      let sent = 0;
      for await (const frame of frames) {
        opts.signal?.throwIfAborted();
        if (failure) throw failure;
        const buf = frame.buffer.slice(
          frame.byteOffset,
          frame.byteOffset + frame.byteLength,
        ) as ArrayBuffer;
        send({ type: 'frame', data: buf }, [buf]);
        sent++;
        while (sent - processed > MAX_IN_FLIGHT && !failure) {
          await new Promise<void>((r) => (wake = r));
          wake = null;
        }
      }
      send({ type: 'end' });
      await done;
      if (failure) throw failure;
      opts.onProgress?.(1);
      return features;
    } finally {
      await worker.terminate();
    }
  }
}
