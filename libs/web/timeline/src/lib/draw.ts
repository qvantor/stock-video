import { MOTION_COLORS } from './colors';
import { formatTick, tickStep, timeToX, xToTime, type Viewport } from './geometry';
import type { TimelineMetrics, TimelineSprite } from './types';

export const RULER_H = 22;
const THUMBS_H = 54;
const GRAPH_H = 52;
export const BANDS_H = RULER_H + THUMBS_H + GRAPH_H;

const C = {
  bg: '#0a0a0a',
  band: '#171717',
  grid: '#262626',
  tick: '#525252',
  label: '#a3a3a3',
  speed: '#38bdf8',
  smooth: 'rgba(52, 211, 153, 0.28)',
  smoothLine: 'rgba(52, 211, 153, 0.8)',
};

export const drawBands = (
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  duration: number,
  sprite: { data: TimelineSprite; image: HTMLImageElement } | null,
  metrics: TimelineMetrics | null | undefined,
): void => {
  const w = v.width;
  ctx.clearRect(0, 0, w, BANDS_H);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, BANDS_H);
  const endX = Math.min(w, timeToX(duration, v));

  // Ruler
  const step = tickStep(v.pxPerSec);
  const minor = step / 5;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const first = Math.floor(v.start / minor) * minor;
  for (let t = first; t <= Math.min(duration, xToTime(w, v)); t += minor) {
    const x = Math.round(timeToX(t, v)) + 0.5;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ctx.strokeStyle = major ? C.tick : C.grid;
    ctx.beginPath();
    ctx.moveTo(x, major ? 8 : 15);
    ctx.lineTo(x, RULER_H);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = C.label;
      ctx.fillText(formatTick(t, step), x + 3, 2);
    }
  }

  // Thumbnails
  const ty = RULER_H;
  ctx.fillStyle = C.band;
  ctx.fillRect(0, ty, endX, THUMBS_H);
  if (sprite && sprite.image.complete && sprite.image.naturalWidth > 0) {
    const m = sprite.data.meta;
    const slotW = (m.tileWidth * THUMBS_H) / m.tileHeight;
    const absStart = v.start * v.pxPerSec;
    let slot = Math.floor(absStart / slotW);
    for (;;) {
      const x = slot * slotW - absStart;
      if (x >= endX) break;
      const tMid = ((slot + 0.5) * slotW) / v.pxPerSec;
      const idx = Math.max(0, Math.min(m.count - 1, Math.floor(tMid / m.interval)));
      const sx = (idx % m.columns) * m.tileWidth;
      const sy = Math.floor(idx / m.columns) * m.tileHeight;
      const drawW = Math.min(slotW, endX - x);
      ctx.drawImage(
        sprite.image,
        sx,
        sy,
        (m.tileWidth * drawW) / slotW,
        m.tileHeight,
        x,
        ty,
        drawW,
        THUMBS_H,
      );
      slot++;
    }
  }

  // Motion graph
  const gy = RULER_H + THUMBS_H;
  ctx.fillStyle = C.band;
  ctx.fillRect(0, gy, endX, GRAPH_H);
  if (metrics && metrics.t.length > 0) {
    const t0 = metrics.t[0] ?? 0;
    const n = metrics.t.length;
    const sampleAt = (x: number) =>
      Math.max(0, Math.min(n - 1, Math.round((xToTime(x, v) - t0) * metrics.fps)));
    const inner = GRAPH_H - 8;
    const base = gy + GRAPH_H - 4;
    const stepPx = 2;

    // Smoothness area
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let x = 0; x <= endX; x += stepPx) {
      ctx.lineTo(x, base - (metrics.smoothness[sampleAt(x)] ?? 0) * inner);
    }
    ctx.lineTo(endX, base);
    ctx.closePath();
    ctx.fillStyle = C.smooth;
    ctx.fill();

    // Speed line
    ctx.beginPath();
    for (let x = 0; x <= endX; x += stepPx) {
      const y = base - (metrics.speed[sampleAt(x)] ?? 0) * inner;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = C.speed;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;

    // Detected motion class strip
    if (metrics.motion) {
      for (let x = 0; x < endX; x += stepPx) {
        const label = metrics.motion[sampleAt(x)];
        if (!label) continue;
        ctx.fillStyle = MOTION_COLORS[label];
        ctx.fillRect(x, gy + GRAPH_H - 3, stepPx, 3);
      }
    }
  }

  // Band separators
  ctx.fillStyle = C.grid;
  ctx.fillRect(0, RULER_H, w, 1);
  ctx.fillRect(0, gy, w, 1);
};
