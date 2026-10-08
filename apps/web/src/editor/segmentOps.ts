import type { MotionType, Segment, VideoMetrics } from '@dfs/contracts';
import { snapToFrame } from '@dfs/contracts';

/** Pure operations on one video's segment list. All return a new list sorted by start. */

const sorted = (list: Segment[]): Segment[] => [...list].sort((a, b) => a.startSec - b.startSec);

const newId = (): string => crypto.randomUUID();

/** Mark AI segments touched by the user. */
const touched = (s: Segment): Segment => (s.origin === 'ai' ? { ...s, edited: true } : s);

/** Most frequent detected motion in [start, end) from the metrics, if available. */
const dominantMotion = (
  metrics: VideoMetrics | null | undefined,
  start: number,
  end: number,
): MotionType | null => {
  if (!metrics) return null;
  const counts = new Map<MotionType, number>();
  metrics.t.forEach((t, i) => {
    const m = metrics.motion[i];
    if (m && t >= start && t < end) counts.set(m, (counts.get(m) ?? 0) + 1);
  });
  let best: MotionType | null = null;
  let n = 0;
  for (const [m, c] of counts) {
    if (c > n) {
      best = m;
      n = c;
    }
  }
  return best;
};

const meanSmoothness = (metrics: VideoMetrics | null | undefined, start: number, end: number) => {
  if (!metrics) return 0;
  const vals = metrics.smoothness.filter((_, i) => {
    const t = metrics.t[i] ?? -1;
    return t >= start && t < end;
  });
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0;
};

export const createSegment = (
  list: Segment[],
  videoId: string,
  start: number,
  end: number,
  fps: number,
  metrics?: VideoMetrics | null,
): { list: Segment[]; id: string } => {
  const s = snapToFrame(Math.min(start, end), fps);
  const e = snapToFrame(Math.max(start, end), fps);
  const motion = dominantMotion(metrics, s, e) ?? 'forward';
  const seg: Segment = {
    id: newId(),
    videoId,
    startSec: s,
    endSec: e,
    motionType: motion === 'erratic' ? 'forward' : motion,
    score: meanSmoothness(metrics, s, e),
    reasons: ['Created manually'],
    origin: 'user',
    accepted: true,
    edited: false,
  };
  return { list: sorted([...list, seg]), id: seg.id };
};

export const setBounds = (
  list: Segment[],
  changes: readonly { id: string; startSec: number; endSec: number }[],
  fps: number,
  duration: number,
): Segment[] => {
  const byId = new Map(changes.map((c) => [c.id, c]));
  return sorted(
    list.map((s) => {
      const c = byId.get(s.id);
      if (!c) return s;
      const start = Math.max(0, snapToFrame(Math.min(c.startSec, c.endSec), fps));
      const end = Math.min(duration, snapToFrame(Math.max(c.startSec, c.endSec), fps));
      if (end - start < 1 / fps / 2) return s;
      if (start === s.startSec && end === s.endSec) return s;
      return touched({ ...s, startSec: start, endSec: end });
    }),
  );
};

/** Accept all if any of them is rejected, otherwise reject all. */
export const toggleAccept = (list: Segment[], ids: ReadonlySet<string>): Segment[] => {
  const target = list.some((s) => ids.has(s.id) && !s.accepted);
  return list.map((s) => (ids.has(s.id) ? { ...s, accepted: target } : s));
};

export const removeSegments = (list: Segment[], ids: ReadonlySet<string>): Segment[] =>
  list.filter((s) => !ids.has(s.id));

/** Split the segment containing `t` (strictly inside) at the nearest frame. */
export const splitAt = (
  list: Segment[],
  id: string,
  t: number,
  fps: number,
): { list: Segment[]; ids: [string, string] } | null => {
  const seg = list.find((s) => s.id === id);
  if (!seg) return null;
  const at = snapToFrame(t, fps);
  if (at <= seg.startSec || at >= seg.endSec) return null;
  const left = touched({ ...seg, endSec: at });
  const right = touched({ ...seg, id: newId(), startSec: at });
  return {
    list: sorted([...list.filter((s) => s.id !== id), left, right]),
    ids: [left.id, right.id],
  };
};

/** Merge selected segments into one spanning them all. Needs at least two. */
export const mergeSegments = (
  list: Segment[],
  ids: ReadonlySet<string>,
): { list: Segment[]; id: string } | null => {
  const parts = list.filter((s) => ids.has(s.id));
  if (parts.length < 2) return null;
  const len = (s: Segment) => s.endSec - s.startSec;
  const longest = parts.reduce((a, b) => (len(b) > len(a) ? b : a));
  const total = parts.reduce((a, s) => a + len(s), 0);
  const merged: Segment = {
    ...longest,
    startSec: Math.min(...parts.map((s) => s.startSec)),
    endSec: Math.max(...parts.map((s) => s.endSec)),
    score: Math.round((parts.reduce((a, s) => a + s.score * len(s), 0) / total) * 100) / 100,
    reasons: [...new Set(parts.flatMap((s) => s.reasons))],
    origin: parts.every((s) => s.origin === 'ai') ? 'ai' : 'user',
    accepted: parts.some((s) => s.accepted),
    edited: true,
  };
  return { list: sorted([...list.filter((s) => !ids.has(s.id)), merged]), id: merged.id };
};

export const setMotionType = (list: Segment[], ids: ReadonlySet<string>, motionType: MotionType) =>
  list.map((s) =>
    ids.has(s.id) && s.motionType !== motionType ? touched({ ...s, motionType }) : s,
  );

/** Segment under time t (the shortest if several overlap). */
export const segmentAt = (list: Segment[], t: number): Segment | undefined =>
  list
    .filter((s) => t >= s.startSec && t < s.endSec)
    .sort((a, b) => a.endSec - a.startSec - (b.endSec - b.startSec))[0];
