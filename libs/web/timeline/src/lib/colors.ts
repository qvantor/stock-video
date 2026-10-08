import type { MotionType } from '@dfs/contracts';

/** Segment colour per motion type (dark-theme friendly). */
export const MOTION_COLORS: Record<MotionType, string> = {
  forward: '#38bdf8',
  backward: '#0ea5e9',
  pan_left: '#a78bfa',
  pan_right: '#8b5cf6',
  tilt_up: '#f472b6',
  tilt_down: '#ec4899',
  orbit_left: '#34d399',
  orbit_right: '#10b981',
  ascend: '#fbbf24',
  descend: '#f59e0b',
  static: '#94a3b8',
  erratic: '#ef4444',
};
