import { z } from 'zod';

export const MOTION_TYPES = [
  'forward',
  'backward',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'orbit_left',
  'orbit_right',
  'ascend',
  'descend',
  'static',
  'erratic',
] as const;

export const MotionTypeSchema = z.enum(MOTION_TYPES);
export type MotionType = z.infer<typeof MotionTypeSchema>;

export const MOTION_LABELS: Record<MotionType, string> = {
  forward: 'Forward',
  backward: 'Backward',
  pan_left: 'Pan left',
  pan_right: 'Pan right',
  tilt_up: 'Tilt up',
  tilt_down: 'Tilt down',
  orbit_left: 'Orbit left',
  orbit_right: 'Orbit right',
  ascend: 'Ascend',
  descend: 'Descend',
  static: 'Hover',
  erratic: 'Erratic',
};
