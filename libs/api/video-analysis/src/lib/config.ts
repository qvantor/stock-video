/**
 * Tunable thresholds of motion classification and segmentation.
 *
 * Units: shifts are in frame widths per second (fw/s), divergence in relative
 * scale change per second, rotation in rad/s. `sensitivity` from the UI scales
 * the boundary/jerk thresholds (higher sensitivity → lower thresholds → more cuts,
 * stricter smoothness).
 */
export const ANALYSIS_CONFIG = {
  /** ffmpeg pre-scaling width for analysis frames (height keeps aspect). */
  analysisWidth: 320,

  flow: {
    /** Farneback parameters, tuned for 320 px wide frames. */
    pyrScale: 0.5,
    levels: 3,
    winSize: 15,
    iterations: 3,
    polyN: 5,
    polySigma: 1.2,
    /** Sample every Nth flow vector when computing statistics. */
    gridStep: 4,
    /** Ignore this many pixels at the border (flow is unreliable there). */
    margin: 8,
    /** Over-exposure: luma at or above this value counts as clipped. */
    clipLuma: 250,
  },

  classify: {
    /** Below this overall activity (fw/s) the shot is a hover. */
    staticMax: 0.006,
    /** Affine-model fit quality below this marks chaotic motion (shake, noise, moving water…). */
    erraticFitMin: 0.45,
    /** Effective radius (fraction of frame width) used to convert zoom/rotation into edge displacement. */
    effectiveRadius: 0.35,
    /** Zoom (forward/backward) wins if its edge displacement ≥ translation × this. */
    zoomDominance: 0.8,
    /**
     * Forward flight with a tilted gimbal expands from a point off the frame centre
     * (focus of expansion, FOE = −shift / divergence). If the FOE lies inside this
     * box (in frame widths from the centre), the motion counts as forward/backward
     * even when the accompanying shift is large.
     */
    foeMaxX: 0.6,
    foeMaxY: 0.45,
    /** Rotation (top-down spin, mapped to orbit) wins if its displacement ≥ others × this. */
    rotationDominance: 1.2,
    /**
     * Orbit: the camera circles a subject while yawing towards it, so the background
     * (top of an oblique drone frame) and the foreground (bottom) shift in opposite
     * directions — strong horizontal parallax with a small mean shift. A sample is an
     * orbit when |px| ≥ `orbitParallaxMin` and |dx| ≤ `orbitParallaxRatio` × |px|
     * (|dx| < |px|/2 ⇔ top and bottom move in opposite directions). A sideways truck has
     * parallax too, but everything moves the same way, so it stays a pan.
     * Direction: background (top) moving right = orbit_right.
     */
    orbitParallaxRatio: 0.6,
    orbitParallaxMin: 0.01,
    /** Vertical motion with parallax ≥ this share of the shift = ascend/descend, otherwise tilt. */
    ascendParallaxRatio: 0.35,
  },

  segment: {
    /** Window of the median/mode filter over per-sample labels and features, seconds. */
    smoothWindowSec: 1.6,
    /** Relative speed change (vs. the preceding window) that forces a boundary. */
    speedJumpRatio: 0.6,
    /** Window for the speed-jump reference median, seconds. */
    speedJumpWindowSec: 2,
    /** Ignore speed jumps when both speeds are below this (fw/s): noise at near-zero speed. */
    speedJumpFloor: 0.01,
    /** Jerk: sample-to-sample change of the mean vector above k × median absolute change. */
    jerkFactor: 6,
    /** Absolute floor for jerk detection (fw/s). */
    jerkFloor: 0.02,
    /** Sharpness below this share of the video's median = blur. */
    blurRatio: 0.35,
    /** Mean luma outside [darkLuma, brightLuma] or clipped share > clipShare = bad exposure. */
    darkLuma: 25,
    brightLuma: 235,
    clipShare: 0.12,
    /** Short same-class gaps (label flicker) up to this length are merged, seconds. */
    mergeGapSec: 1.2,
    /** Cut this much from both ends of every run to drop transition jitter, seconds. */
    trimSec: 0.5,
    /** When splitting long runs, search this far around the ideal cut for the stablest point, seconds. */
    splitSearchSec: 4,
    /** Speed (fw/s) mapped to 1.0 on the timeline graph. */
    speedGraphMax: 0.1,
  },

  score: {
    weights: { smoothness: 0.35, speedStability: 0.25, sharpness: 0.2, exposure: 0.2 },
    /** Penalty per detected jerk inside a segment. */
    jerkPenalty: 0.06,
    /** Coefficient of variation of speed that maps to zero stability. */
    speedCvMax: 0.6,
  },
} as const;

export type AnalysisConfig = typeof ANALYSIS_CONFIG;
