import type { MotionType } from '@dfs/contracts';
import { ANALYSIS_CONFIG } from './config.js';
import type { FrameFeatures } from './types.js';

type ClassifyConfig = typeof ANALYSIS_CONFIG.classify;

/** Overall motion magnitude (fw/s) combining translation, zoom, rotation and parallax. */
export const motionActivity = (
  f: FrameFeatures,
  cfg: ClassifyConfig = ANALYSIS_CONFIG.classify,
): number => {
  const r = cfg.effectiveRadius;
  return Math.max(
    Math.abs(f.dx),
    Math.abs(f.dy),
    Math.abs(f.div) * r,
    Math.abs(f.rot) * r,
    Math.abs(f.px) / 2,
    Math.abs(f.py) / 2,
  );
};

/** Scalar speed for graphs and stability: translation + zoom + rotation + parallax contributions. */
export const motionSpeed = (
  f: FrameFeatures,
  cfg: ClassifyConfig = ANALYSIS_CONFIG.classify,
): number => {
  const r = cfg.effectiveRadius;
  return Math.hypot(f.dx, f.dy) + Math.abs(f.div) * r + Math.abs(f.rot) * r + Math.abs(f.px) / 2;
};

/**
 * Classify one frame pair. Image-space conventions: content moving left (dx<0)
 * means the camera turns/moves right → pan_right; content moving down (dy>0)
 * means tilt up / ascend. A top-down spin (pure image rotation) has no class of
 * its own and is reported as an orbit (content clockwise → orbit_left).
 */
export const classifySample = (
  f: FrameFeatures,
  sensitivity = 1,
  cfg: ClassifyConfig = ANALYSIS_CONFIG.classify,
): MotionType => {
  const r = cfg.effectiveRadius;
  const tx = Math.abs(f.dx);
  const ty = Math.abs(f.dy);
  const zoom = Math.abs(f.div) * r;
  const rot = Math.abs(f.rot) * r;
  const parX = Math.abs(f.px);
  const parY = Math.abs(f.py);

  if (motionActivity(f, cfg) < cfg.staticMax) return 'static';
  // Higher sensitivity → stricter smoothness requirement.
  const fitMin = 1 - (1 - cfg.erraticFitMin) / Math.max(0.25, sensitivity);
  if (f.fit < fitMin) return 'erratic';

  const trans = Math.max(tx, ty);
  if (rot >= cfg.rotationDominance * Math.max(trans, zoom, parX / 2)) {
    return f.rot > 0 ? 'orbit_left' : 'orbit_right';
  }
  const absDiv = Math.abs(f.div);
  const foeInFrame =
    zoom >= cfg.staticMax && tx <= cfg.foeMaxX * absDiv && ty <= cfg.foeMaxY * absDiv;
  if (foeInFrame || zoom >= cfg.zoomDominance * Math.max(trans, parX / 2)) {
    return f.div > 0 ? 'forward' : 'backward';
  }

  const horizontal = Math.max(tx, parX / 2);
  const vertical = Math.max(ty, parY / 2);
  if (horizontal >= vertical) {
    if (parX >= cfg.orbitParallaxMin && tx <= cfg.orbitParallaxRatio * parX) {
      return f.px > 0 ? 'orbit_right' : 'orbit_left';
    }
    return f.dx < 0 ? 'pan_right' : 'pan_left';
  }
  if (parY >= cfg.ascendParallaxRatio * ty) {
    return f.dy > 0 ? 'ascend' : 'descend';
  }
  return f.dy > 0 ? 'tilt_up' : 'tilt_down';
};
