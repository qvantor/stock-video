import type { FrameFeatures } from './types.js';

export type ToWorker =
  | { type: 'init'; width: number; height: number; fps: number }
  | { type: 'frame'; data: ArrayBuffer }
  | { type: 'end' };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'features'; features: FrameFeatures | null }
  | { type: 'done' }
  | { type: 'error'; message: string };
