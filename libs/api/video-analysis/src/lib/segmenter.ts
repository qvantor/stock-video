import { formatShortTime, type AnalysisSettings, type MotionType } from '@dfs/contracts';
import { classifySample, motionSpeed } from './classify.js';
import { ANALYSIS_CONFIG, type AnalysisConfig } from './config.js';
import {
  clamp01,
  mean,
  median,
  medianFilter,
  modeFilter,
  stdDev,
  windowSamples,
} from './filters.js';
import type { FrameFeatures, SegmentationResult, SegmentProposal } from './types.js';

export type SegmentSettings = Pick<
  AnalysisSettings,
  'minDuration' | 'maxDuration' | 'targetDuration' | 'sensitivity' | 'includeStatic'
>;

type BreakReason = 'label' | 'bad' | 'jump' | 'start';

interface Run {
  start: number; // sample index, inclusive
  end: number; // sample index, exclusive
  label: MotionType;
  /** Why the run starts here (what separates it from the previous run). */
  breakBefore: BreakReason;
}

const MOTION_PHRASE: Record<MotionType, string> = {
  forward: 'forward fly-through',
  backward: 'backward fly-out',
  pan_left: 'pan left',
  pan_right: 'pan right',
  tilt_up: 'camera tilt up',
  tilt_down: 'camera tilt down',
  orbit_left: 'orbit left',
  orbit_right: 'orbit right',
  ascend: 'ascent',
  descend: 'descent',
  static: 'hover',
  erratic: 'erratic motion',
};

/** Per-sample signals derived once from the features. */
interface Signals {
  fps: number;
  labels: MotionType[];
  speed: number[];
  fit: number[];
  /** Sample cannot be part of a segment (strong jerk, blur, bad exposure). */
  bad: boolean[];
  /** Mild jerk / flow variance spike: allowed inside a segment, lowers its score. */
  jerk: boolean[];
  blur: boolean[];
  clipped: boolean[];
  /** Speed jump boundary before this sample. */
  jump: boolean[];
  /** Local instability, used to pick split points. */
  instability: number[];
  sharpnessRef: number;
}

const computeSignals = (
  features: readonly FrameFeatures[],
  fps: number,
  settings: SegmentSettings,
  cfg: AnalysisConfig,
): Signals => {
  const sc = cfg.segment;
  const sens = Math.max(0.25, settings.sensitivity);
  const r = cfg.classify.effectiveRadius;
  const w = windowSamples(sc.smoothWindowSec, fps);

  const rawLabels = features.map((f) => classifySample(f, sens, cfg.classify));
  const labels = modeFilter(rawLabels, w);
  const speed = medianFilter(
    features.map((f) => motionSpeed(f, cfg.classify)),
    w,
  );
  const fit = medianFilter(
    features.map((f) => f.fit),
    w,
  );

  // Jerks: sudden change of the motion vector between consecutive samples.
  const change = features.map((f, i) => {
    const p = features[i - 1];
    if (!p) return 0;
    return (
      Math.hypot(f.dx - p.dx, f.dy - p.dy) +
      Math.abs(f.div - p.div) * r +
      Math.abs(f.rot - p.rot) * r
    );
  });
  const jerkThreshold = Math.max(sc.jerkFloor, sc.jerkFactor * median(change)) / sens;
  const varThreshold =
    Math.max(sc.jerkFloor ** 2, sc.jerkFactor * median(features.map((f) => f.magVar))) / sens;

  const sharpnessRef = median(features.map((f) => f.sharpness));
  const blur = features.map((f) => sharpnessRef > 0 && f.sharpness < sc.blurRatio * sharpnessRef);
  const clipped = features.map(
    (f) =>
      f.brightness < sc.darkLuma || f.brightness > sc.brightLuma || f.overexposed > sc.clipShare,
  );
  const strongJerk = change.map((c) => c > 2 * jerkThreshold);
  const jerk = features.map(
    (f, i) => !strongJerk[i] && ((change[i] ?? 0) > jerkThreshold || f.magVar > varThreshold),
  );
  const bad = features.map((_, i) => Boolean(strongJerk[i] || blur[i] || clipped[i]));

  // Speed jumps: compare medians of the windows before and after each sample.
  const jw = Math.max(2, Math.round(sc.speedJumpWindowSec * fps));
  const jumpRatio = Math.min(0.95, sc.speedJumpRatio / sens);
  const jumpScore = speed.map((_, i) => {
    if (i < jw || i > speed.length - jw) return 0;
    const before = median(speed.slice(i - jw, i));
    const after = median(speed.slice(i, i + jw));
    const hi = Math.max(before, after);
    if (hi < sc.speedJumpFloor) return 0;
    const rel = Math.abs(after - before) / hi;
    return rel > jumpRatio ? rel : 0;
  });
  // Keep only local maxima so one acceleration yields one boundary.
  const jump = jumpScore.map((s, i) => {
    if (s === 0) return false;
    for (let j = Math.max(0, i - jw); j <= Math.min(jumpScore.length - 1, i + jw); j++) {
      const o = jumpScore[j] ?? 0;
      if (o > s || (o === s && j < i)) return false;
    }
    return true;
  });

  const instability = medianFilter(
    change.map((c, i) => c + Math.abs((speed[i] ?? 0) - (speed[i - 1] ?? speed[i] ?? 0))),
    windowSamples(1, fps),
  );

  return { fps, labels, speed, fit, bad, jerk, blur, clipped, jump, instability, sharpnessRef };
};

/** Split samples into runs of one class, broken by class changes, bad samples and speed jumps. */
const buildRuns = (sig: Signals): Run[] => {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let pendingBreak: BreakReason = 'start';
  for (let i = 0; i < sig.labels.length; i++) {
    const label = sig.labels[i] as MotionType;
    if (sig.bad[i]) {
      if (cur) runs.push(cur);
      cur = null;
      pendingBreak = 'bad';
      continue;
    }
    const breakHere: BreakReason | null = !cur
      ? pendingBreak
      : sig.jump[i]
        ? 'jump'
        : cur.label !== label
          ? 'label'
          : null;
    if (breakHere) {
      if (cur) runs.push(cur);
      cur = { start: i, end: i + 1, label, breakBefore: breakHere };
      pendingBreak = 'label';
    } else if (cur) {
      cur.end = i + 1;
    }
  }
  if (cur) runs.push(cur);
  return runs;
};

/**
 * Merge same-class runs separated only by short label flicker: the runs in between
 * must be contiguous, separated purely by class changes (no bad samples, no speed
 * jumps) and short in total.
 */
const mergeRuns = (runs: readonly Run[], maxGap: number): Run[] => {
  const out: Run[] = [];
  let i = 0;
  while (i < runs.length) {
    const base = { ...(runs[i] as Run) };
    let next = i + 1;
    let merged = true;
    while (merged) {
      merged = false;
      let gap = 0;
      let prevEnd = base.end;
      for (let k = next; k < runs.length; k++) {
        const r = runs[k] as Run;
        if (r.start !== prevEnd || r.breakBefore !== 'label') break;
        if (r.label === base.label) {
          base.end = r.end;
          next = k + 1;
          merged = true;
          break;
        }
        gap += r.end - r.start;
        if (gap > maxGap) break;
        prevEnd = r.end;
      }
    }
    out.push(base);
    i = next;
  }
  return out;
};

interface Piece {
  a: number; // sample index inclusive
  b: number; // sample index exclusive
  label: MotionType;
}

/** Split [a, b) into pieces within [min, max] samples, cutting at the stablest points. */
const splitRun = (piece: Piece, sig: Signals, s: SegmentSettings, cfg: AnalysisConfig): Piece[] => {
  const fps = sig.fps;
  const min = Math.round(s.minDuration * fps);
  const max = Math.round(s.maxDuration * fps);
  const target = s.targetDuration * fps;
  const len = piece.b - piece.a;
  if (len <= max) return [piece];

  const nMin = Math.ceil(len / max);
  const nMax = Math.floor(len / min);
  if (nMin > nMax) {
    // No valid partition (max < 2·min): keep the stablest window of maximal length.
    let best = piece.a;
    let bestCost = Infinity;
    for (let a = piece.a; a + max <= piece.b; a++) {
      const cost = mean(sig.instability.slice(a, a + max));
      if (cost < bestCost) {
        bestCost = cost;
        best = a;
      }
    }
    return [{ ...piece, a: best, b: best + max }];
  }
  const n = Math.max(nMin, Math.min(nMax, Math.round(len / target)));
  const search = Math.round(cfg.segment.splitSearchSec * fps);
  const pieces: Piece[] = [];
  let prev = piece.a;
  for (let k = 1; k < n; k++) {
    const remaining = n - k;
    const ideal = Math.round(piece.a + (k * len) / n);
    const lo = Math.max(prev + min, piece.b - remaining * max, ideal - search);
    const hi = Math.min(prev + max, piece.b - remaining * min, ideal + search);
    let cut = Math.max(Math.min(ideal, hi), lo);
    let bestCost = Infinity;
    for (let c = lo; c <= hi; c++) {
      // Prefer stable points, then closeness to the ideal cut.
      const cost = (sig.instability[c] ?? 0) + (Math.abs(c - ideal) / Math.max(1, search)) * 1e-3;
      if (cost < bestCost) {
        bestCost = cost;
        cut = c;
      }
    }
    pieces.push({ ...piece, a: prev, b: cut });
    prev = cut;
  }
  pieces.push({ ...piece, a: prev, b: piece.b });
  return pieces;
};

const scorePiece = (
  p: Piece,
  sig: Signals,
  features: readonly FrameFeatures[],
  cfg: AnalysisConfig,
): { score: number; reasons: string[] } => {
  const sc = cfg.score;
  const idx = Array.from({ length: p.b - p.a }, (_, i) => p.a + i);
  const t = (i: number) => (features[i]?.t ?? i / sig.fps) + 0.5 / sig.fps;

  const smoothness = clamp01(mean(idx.map((i) => sig.fit[i] ?? 0)));
  const speeds = idx.map((i) => sig.speed[i] ?? 0);
  const meanSpeed = mean(speeds);
  const cv = meanSpeed > cfg.classify.staticMax ? stdDev(speeds) / meanSpeed : 0;
  const speedStability = clamp01(1 - cv / sc.speedCvMax);
  const sharpRel =
    sig.sharpnessRef > 0
      ? median(idx.map((i) => features[i]?.sharpness ?? 0)) / sig.sharpnessRef
      : 1;
  const sharpness = clamp01(sharpRel);
  const exposureQ = mean(
    idx.map((i) => {
      const f = features[i];
      if (!f) return 1;
      const lumaQ =
        f.brightness < 50
          ? clamp01((f.brightness - cfg.segment.darkLuma) / 25)
          : f.brightness > 210
            ? clamp01((cfg.segment.brightLuma - f.brightness) / 25)
            : 1;
      return lumaQ * clamp01(1 - f.overexposed / cfg.segment.clipShare);
    }),
  );
  const exposure = clamp01(exposureQ);

  const jerkTimes: number[] = [];
  for (const i of idx) {
    // Count clusters of jerk samples once.
    if (sig.jerk[i] && !sig.jerk[i - 1]) jerkTimes.push(t(i));
  }

  const w = sc.weights;
  const score = clamp01(
    w.smoothness * smoothness +
      w.speedStability * speedStability +
      w.sharpness * sharpness +
      w.exposure * exposure -
      sc.jerkPenalty * jerkTimes.length,
  );

  const phrase = MOTION_PHRASE[p.label];
  const reasons: string[] = [];
  if (smoothness >= 0.8) reasons.push(`Smooth motion: ${phrase}`);
  else if (smoothness >= 0.6) reasons.push(`Fairly smooth motion: ${phrase}`);
  else reasons.push(`Uneven motion: ${phrase}`);
  if (p.label !== 'static') {
    if (speedStability >= 0.8) reasons.push('Steady speed');
    else if (speedStability < 0.5) reasons.push('Speed varies noticeably');
  }
  for (const jt of jerkTimes.slice(0, 3)) reasons.push(`Slight jerk at ${formatShortTime(jt)}`);
  if (jerkTimes.length > 3) reasons.push(`More jerks: ${jerkTimes.length - 3}`);
  if (sharpness < 0.6) reasons.push('Softer than usual (possible blur)');
  if (exposure < 0.7) {
    const worst = idx.reduce((a, b) =>
      (features[b]?.overexposed ?? 0) > (features[a]?.overexposed ?? 0) ? b : a,
    );
    reasons.push(
      (features[worst]?.overexposed ?? 0) > cfg.segment.clipShare / 2
        ? `Overexposure at ${formatShortTime(t(worst))}`
        : 'Imperfect exposure',
    );
  }
  return { score: Math.round(score * 100) / 100, reasons };
};

/**
 * Turn per-sample motion features into stock-ready segment proposals:
 * classify → smooth → find boundaries → merge → trim → length rules → filter → score.
 */
export const segmentFeatures = (
  features: readonly FrameFeatures[],
  fps: number,
  settings: SegmentSettings,
  cfg: AnalysisConfig = ANALYSIS_CONFIG,
): SegmentationResult => {
  if (features.length === 0) return { segments: [], labels: [], speed: [], smoothness: [] };
  const sig = computeSignals(features, fps, settings, cfg);
  const runs = mergeRuns(buildRuns(sig), Math.round(cfg.segment.mergeGapSec * fps));

  const trimSec = cfg.segment.trimSec;
  const trim = Math.ceil(trimSec * fps - 1e-9);
  const timeAt = (i: number) => features[i]?.t ?? i / fps;
  const segments: SegmentProposal[] = [];
  for (const run of runs) {
    if (run.label === 'erratic') continue;
    if (run.label === 'static' && !settings.includeStatic) continue;
    // Exact trimmed bounds in seconds; sample indices are used for scoring and splitting.
    const runStart = timeAt(run.start) + trimSec;
    const runEnd = timeAt(run.end - 1) + 1 / fps - trimSec;
    if (runEnd - runStart < settings.minDuration) continue;
    const a = run.start + trim;
    const b = run.end - trim;
    const pieces = splitRun({ a, b, label: run.label }, sig, settings, cfg);
    pieces.forEach((piece, k) => {
      const startSec = k === 0 ? runStart : timeAt(piece.a);
      const endSec = k === pieces.length - 1 ? runEnd : timeAt(piece.b);
      if (endSec - startSec < settings.minDuration - 1e-6) return;
      segments.push({
        startSec,
        endSec,
        motionType: piece.label,
        ...scorePiece(piece, sig, features, cfg),
      });
    });
  }

  return {
    segments,
    labels: sig.labels,
    speed: sig.speed.map((v) => Math.round(clamp01(v / cfg.segment.speedGraphMax) * 1000) / 1000),
    smoothness: sig.fit.map((v) => Math.round(clamp01(v) * 1000) / 1000),
  };
};
