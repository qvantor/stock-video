import { parentPort, workerData } from 'node:worker_threads';
import { FrameAnalyzer } from './frame-analyzer.js';
import { loadOpenCv } from './opencv.js';
import type { FromWorker, ToWorker } from './worker-protocol.js';

/** workerData marker telling an entry script to run the flow worker loop. */
export const FLOW_WORKER_ROLE = 'dfs-flow-worker';

export const isFlowWorkerThread = (): boolean =>
  typeof workerData === 'object' &&
  workerData !== null &&
  'role' in workerData &&
  workerData.role === FLOW_WORKER_ROLE;

/**
 * Worker-thread loop: computes motion features with opencv-js off the main event
 * loop. Protocol: see worker-protocol.ts. Call from the entry script when
 * `isFlowWorkerThread()` is true.
 */
export const runFlowWorker = (): void => {
  const port = parentPort;
  if (!port) throw new Error('runFlowWorker must be called inside worker_threads');
  let analyzer: FrameAnalyzer | null = null;
  const post = (msg: FromWorker) => port.postMessage(msg);

  // Messages are handled strictly in order: init awaits WASM before frames arrive
  // (the main thread waits for `ready`).
  port.on('message', (msg: ToWorker) => {
    void (async () => {
      try {
        switch (msg.type) {
          case 'init': {
            const cv = await loadOpenCv();
            analyzer?.dispose();
            analyzer = new FrameAnalyzer(cv, msg.width, msg.height, msg.fps);
            post({ type: 'ready' });
            break;
          }
          case 'frame':
            if (!analyzer) throw new Error('worker not initialised');
            post({ type: 'features', features: analyzer.push(new Uint8Array(msg.data)) });
            break;
          case 'end':
            analyzer?.dispose();
            analyzer = null;
            post({ type: 'done' });
            break;
        }
      } catch (err) {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
};
