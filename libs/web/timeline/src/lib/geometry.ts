/** Visible window of the timeline. */
export interface Viewport {
  /** Time at the left edge, seconds. */
  start: number;
  /** Zoom, pixels per second. */
  pxPerSec: number;
  /** Visible width, px. */
  width: number;
}

export const timeToX = (t: number, v: Viewport): number => (t - v.start) * v.pxPerSec;
export const xToTime = (x: number, v: Viewport): number => v.start + x / v.pxPerSec;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export const snapToFrame = (t: number, fps: number): number => Math.round(t * fps) / fps;

/** Zoom limits: whole video fits at minimum, ~40 px per frame at maximum. */
export const zoomLimits = (duration: number, width: number, fps: number) => ({
  min: width > 0 && duration > 0 ? width / duration : 1,
  max: Math.max(fps * 40, width > 0 && duration > 0 ? width / duration : 1),
});

/** Keep the viewport inside [0, duration]. */
export const clampViewport = (v: Viewport, duration: number): Viewport => {
  const visible = v.width / v.pxPerSec;
  const maxStart = Math.max(0, duration - visible);
  return { ...v, start: clamp(v.start, 0, maxStart) };
};

/** Zoom by `factor` keeping the time under `anchorX` fixed. */
export const zoomAt = (
  v: Viewport,
  factor: number,
  anchorX: number,
  duration: number,
  fps: number,
): Viewport => {
  const { min, max } = zoomLimits(duration, v.width, fps);
  const pxPerSec = clamp(v.pxPerSec * factor, min, max);
  const anchorT = xToTime(anchorX, v);
  return clampViewport({ ...v, pxPerSec, start: anchorT - anchorX / pxPerSec }, duration);
};

const NICE_STEPS = [
  1 / 30,
  1 / 10,
  0.2,
  0.5,
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  3600,
];

/** Ruler tick step (s) so that labels are at least `minPx` apart. */
export const tickStep = (pxPerSec: number, minPx = 80): number =>
  NICE_STEPS.find((s) => s * pxPerSec >= minPx) ?? 3600;

/**
 * Snap `t` to the nearest target within `thresholdPx`; otherwise to the frame grid.
 * Returns the snapped time and whether it stuck to a target.
 */
export const snapTime = (
  t: number,
  targets: readonly number[],
  pxPerSec: number,
  fps: number,
  thresholdPx = 8,
): { t: number; snapped: boolean } => {
  let best = t;
  let bestDist = thresholdPx / pxPerSec;
  let snapped = false;
  for (const target of targets) {
    const d = Math.abs(target - t);
    if (d <= bestDist) {
      best = target;
      bestDist = d;
      snapped = true;
    }
  }
  return { t: snapped ? best : snapToFrame(t, fps), snapped };
};

/** Human label for ruler ticks. */
export const formatTick = (t: number, step: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (step < 1) return `${m}:${s.toFixed(step < 0.1 ? 2 : 1).padStart(step < 0.1 ? 5 : 4, '0')}`;
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
};
