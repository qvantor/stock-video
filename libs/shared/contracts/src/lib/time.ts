/** Round a time (s) to the nearest frame boundary of a stream with the given fps. */
export const snapToFrame = (sec: number, fps: number): number => Math.round(sec * fps) / fps;

export const secToFrame = (sec: number, fps: number): number => Math.round(sec * fps);

/** `mm:ss.ff` (or `h:mm:ss.ff`) where ff is hundredths of a second. */
export const formatTimecode = (sec: number): string => {
  const safe = Math.max(0, sec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe * 100) % 100);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${pad(m)}:${pad(s)}.${pad(cs)}`;
  return h > 0 ? `${h}:${base}` : base;
};

/** `mm:ss` for human-readable reasons. */
export const formatShortTime = (sec: number): string => {
  const safe = Math.max(0, Math.round(sec));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

/** Parse `[[h:]mm:]ss[.fff]` → seconds, or null if malformed. */
export const parseTimecode = (input: string): number | null => {
  const parts = input.trim().split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
};
