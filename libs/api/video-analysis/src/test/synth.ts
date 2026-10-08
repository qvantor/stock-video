/** Synthetic grayscale "drone footage" generated in memory for tests. */

const hash = (ix: number, iy: number): number => {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Continuous value noise (cell size `s` px), so sub-pixel motion stays smooth. */
const valueNoise = (x: number, y: number, s: number): number => {
  const gx = x / s;
  const gy = y / s;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};

/** Rich, non-periodic texture with structure at several scales. */
const texture = (x: number, y: number): number =>
  20 +
  110 * valueNoise(x, y, 9) +
  70 * valueNoise(x + 1000, y - 500, 23) +
  35 * Math.sin(0.05 * x + 0.03 * y);

/** Maps a target pixel (x, y) of frame k to texture coordinates. */
export type Warp = (k: number, x: number, y: number) => [number, number];

export const W = 320;
export const H = 180;
const CX = W / 2;
const CY = H / 2;

export const renderFrames = (n: number, warp: Warp, w = W, h = H): Uint8Array[] =>
  Array.from({ length: n }, (_, k) => {
    const frame = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [sx, sy] = warp(k, x, y);
        frame[y * w + x] = Math.max(0, Math.min(255, Math.round(texture(sx, sy))));
      }
    }
    return frame;
  });

/** Camera turns right: content slides left by `v` px/frame. */
export const panRight =
  (v = 3): Warp =>
  (k, x, y) => [x + v * k, y];
export const panLeft =
  (v = 3): Warp =>
  (k, x, y) => [x - v * k, y];

/** Camera moves forward: content expands by factor `s` per frame. */
export const zoom =
  (s: number): Warp =>
  (k, x, y) => {
    const f = s ** -k;
    return [CX + (x - CX) * f, CY + (y - CY) * f];
  };

/** Expansion around an off-centre point (fx, fy in px) — e.g. forward flight with a tilted gimbal. */
export const zoomAt =
  (s: number, fx: number, fy: number): Warp =>
  (k, x, y) => {
    const f = s ** -k;
    return [fx + (x - fx) * f, fy + (y - fy) * f];
  };

/** Content rotates clockwise on screen by `theta` rad per frame. */
export const rotate =
  (theta: number): Warp =>
  (k, x, y) => {
    const a = -theta * k;
    const rx = x - CX;
    const ry = y - CY;
    return [CX + rx * Math.cos(a) - ry * Math.sin(a), CY + rx * Math.sin(a) + ry * Math.cos(a)];
  };

/** Orbit: background (top) slides right, foreground (bottom) slides left. */
export const orbitRight =
  (a = 2.5): Warp =>
  (k, x, y) => [x - a * k * (1 - (2 * y) / H), y];

/** Camera tilts up: whole frame content slides down uniformly. */
export const tiltUp =
  (v = 3): Warp =>
  (k, x, y) => [x, y - v * k];

/** Drone ascends with an oblique camera: content slides down, near (bottom) faster. */
export const ascend =
  (v = 3): Warp =>
  (k, x, y) => [x, y - v * k * (0.2 + (1.6 * y) / H)];

export const still = (): Warp => (_k, x, y) => [x, y];

/** Independent random frames: no coherent motion at all. */
export const noiseFrames = (n: number, w = W, h = H): Uint8Array[] =>
  Array.from({ length: n }, (_, k) => {
    const f = new Uint8Array(w * h);
    for (let i = 0; i < f.length; i++) f[i] = Math.floor(hash(i, k * 7919 + 13) * 256);
    return f;
  });

export async function* iterate(frames: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const f of frames) yield f;
}
