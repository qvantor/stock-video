import { emptyStatusCounts, type ClipStatus } from '@dfs/contracts';
import type { ClipRecord } from './types.js';

/** Position of each status on a 0..5 scale (five steps). */
const WEIGHT: Record<ClipStatus, number> = {
  queued: 0,
  frames: 0,
  geo: 1,
  tech: 2,
  llm: 3,
  review: 4,
  cut: 4,
  done: 5,
  failed: 0,
};

export const clipProgress = (clip: Pick<ClipRecord, 'status' | 'progress'>): number =>
  Math.min(1, (WEIGHT[clip.status] + (clip.status === 'done' ? 0 : clip.progress)) / 5);

export interface JobCounts {
  total: number;
  excluded: number;
  counts: Record<ClipStatus, number>;
  progress: number;
  canBuild: boolean;
}

export const summarizeClips = (clips: ClipRecord[]): JobCounts => {
  const counts = emptyStatusCounts();
  const active = clips.filter((c) => !c.excluded);
  for (const c of active) counts[c.status]++;
  const progress = active.length
    ? active.reduce((sum, c) => sum + clipProgress(c), 0) / active.length
    : 0;
  return {
    total: clips.length,
    excluded: clips.length - active.length,
    counts,
    progress,
    canBuild: active.length > 0 && active.every((c) => c.status === 'done'),
  };
};

export const isTerminal = (status: ClipStatus): boolean =>
  status === 'review' || status === 'done' || status === 'failed';
