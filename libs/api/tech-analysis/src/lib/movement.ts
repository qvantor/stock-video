import type { MotionType } from '@dfs/contracts';

/** Always present for drone footage. */
const BASE = ['Aerial', 'Drone'];

/** Stage-1 motion type → Envato "Movement" values. */
export const ENVATO_MOVEMENT: Record<MotionType, string[]> = {
  forward: [],
  backward: [],
  pan_left: ['Tracking Left'],
  pan_right: ['Tracking Right'],
  tilt_up: ['Tilt Up'],
  tilt_down: ['Tilt Down'],
  orbit_left: ['Arc'],
  orbit_right: ['Arc'],
  ascend: [],
  descend: [],
  static: [],
  erratic: [],
};

/** Envato Movement list for a clip; `topDown` when the gimbal points straight down. */
export const mapMovement = (motion: MotionType, opts: { topDown?: boolean } = {}): string[] => [
  ...BASE,
  ...ENVATO_MOVEMENT[motion],
  ...(opts.topDown ? ['Top Down'] : []),
];

/** Plain-English camera movement for prompts and keywords. */
export const MOTION_PHRASES: Record<MotionType, string> = {
  forward: 'flying forward',
  backward: 'flying backward (reveal)',
  pan_left: 'panning / trucking left',
  pan_right: 'panning / trucking right',
  tilt_up: 'tilting up (reveal)',
  tilt_down: 'tilting down',
  orbit_left: 'orbiting around the subject',
  orbit_right: 'orbiting around the subject',
  ascend: 'ascending / rising',
  descend: 'descending',
  static: 'hovering (static shot)',
  erratic: 'free camera movement',
};
