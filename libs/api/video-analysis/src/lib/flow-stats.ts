import { ANALYSIS_CONFIG } from './config.js';
import type { FrameFeatures } from './types.js';

export type FlowStats = Pick<
  FrameFeatures,
  'dx' | 'dy' | 'div' | 'rot' | 'px' | 'py' | 'fit' | 'coherence' | 'magVar'
>;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Summarise a dense optical-flow field (interleaved u,v per pixel, in px/frame)
 * by a least-squares affine motion model u = a + c1·rx + c2·ry, v = b + c3·rx + c4·ry
 * around the frame centre, and derive translation, zoom, rotation and parallax.
 * Values are normalised to frame widths per second using `fps` and `width`.
 */
export const computeFlowStats = (
  flow: Float32Array,
  width: number,
  height: number,
  fps: number,
  cfg = ANALYSIS_CONFIG.flow,
): FlowStats => {
  const step = cfg.gridStep;
  const m = Math.min(cfg.margin, Math.floor(width / 4), Math.floor(height / 4));

  // Grid centre = mean of sampled coordinates → Σrx = Σry = Σrx·ry = 0, so the
  // normal equations decouple into independent 1-D regressions.
  let n = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = m; y < height - m; y += step) {
    for (let x = m; x < width - m; x += step) {
      sumX += x;
      sumY += y;
      n++;
    }
  }
  if (n === 0) {
    return { dx: 0, dy: 0, div: 0, rot: 0, px: 0, py: 0, fit: 1, coherence: 1, magVar: 0 };
  }
  const cx = sumX / n;
  const cy = sumY / n;

  let su = 0;
  let sv = 0;
  let surx = 0;
  let sury = 0;
  let svrx = 0;
  let svry = 0;
  let srx2 = 0;
  let sry2 = 0;
  let sFlow2 = 0;
  let sMag = 0;
  let sMag2 = 0;
  for (let y = m; y < height - m; y += step) {
    const ry = y - cy;
    for (let x = m; x < width - m; x += step) {
      const rx = x - cx;
      const i = (y * width + x) * 2;
      const u = flow[i] ?? 0;
      const v = flow[i + 1] ?? 0;
      su += u;
      sv += v;
      surx += u * rx;
      sury += u * ry;
      svrx += v * rx;
      svry += v * ry;
      srx2 += rx * rx;
      sry2 += ry * ry;
      const f2 = u * u + v * v;
      sFlow2 += f2;
      const mag = Math.sqrt(f2);
      sMag += mag;
      sMag2 += f2;
    }
  }
  const a = su / n;
  const b = sv / n;
  const c1 = srx2 > 0 ? surx / srx2 : 0;
  const c2 = sry2 > 0 ? sury / sry2 : 0;
  const c3 = srx2 > 0 ? svrx / srx2 : 0;
  const c4 = sry2 > 0 ? svry / sry2 : 0;

  // Residuals and coherence (second pass).
  const meanLen = Math.hypot(a, b);
  let sRes2 = 0;
  let aligned = 0;
  let moving = 0;
  for (let y = m; y < height - m; y += step) {
    const ry = y - cy;
    for (let x = m; x < width - m; x += step) {
      const rx = x - cx;
      const i = (y * width + x) * 2;
      const u = flow[i] ?? 0;
      const v = flow[i + 1] ?? 0;
      const eu = u - (a + c1 * rx + c2 * ry);
      const ev = v - (b + c3 * rx + c4 * ry);
      sRes2 += eu * eu + ev * ev;
      const len = Math.hypot(u, v);
      if (len > 0.05) {
        moving++;
        if (meanLen > 1e-6 && (u * a + v * b) / (len * meanLen) > 0.8) aligned++;
      }
    }
  }

  const flowRms = Math.sqrt(sFlow2 / n);
  const resRms = Math.sqrt(sRes2 / n);
  // Tiny flow: the fit ratio is meaningless (noise dominates) — treat as perfectly smooth.
  const fit = flowRms < 0.05 ? 1 : clamp01(1 - resRms / flowRms);

  // Rotation = antisymmetric part where c2 and c3 have opposite signs; the rest of
  // ∂u/∂y is shear (horizontal parallax). Zoom = isotropic part of c1/c4 (same sign);
  // the remaining anisotropic part of ∂v/∂y is vertical parallax (ascend/descend).
  const rotPure = c2 * c3 < 0 ? Math.sign(c3) * Math.min(Math.abs(c2), Math.abs(c3)) : 0;
  const shearX = c2 + rotPure;
  const div = c1 * c4 > 0 ? Math.sign(c1) * Math.min(Math.abs(c1), Math.abs(c4)) : 0;

  const k = fps / width; // px/frame → fw/s
  const meanMag = sMag / n;
  return {
    dx: a * k,
    dy: b * k,
    div: div * fps,
    rot: rotPure * fps,
    px: -shearX * height * k,
    py: (c4 - div) * height * k,
    fit,
    coherence: moving > 0 ? aligned / moving : 1,
    magVar: Math.max(0, sMag2 / n - meanMag * meanMag) * k * k,
  };
};

/** Brightness statistics of an 8-bit grayscale frame. */
export const computeExposure = (
  gray: Uint8Array,
  clipLuma = ANALYSIS_CONFIG.flow.clipLuma,
): { brightness: number; overexposed: number } => {
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] ?? 0;
    sum += v;
    if (v >= clipLuma) clipped++;
  }
  const n = Math.max(1, gray.length);
  return { brightness: sum / n, overexposed: clipped / n };
};
