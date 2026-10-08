import type { MotionType } from '@dfs/contracts';

/**
 * Motion features of one analysed frame pair (frames i and i+1 at analysisFps).
 * Spatial quantities are normalised to "frame widths per second" so they do
 * not depend on analysis resolution or frame rate.
 */
export interface FrameFeatures {
  /** Start of the interval covered by this pair, seconds. */
  t: number;
  /** Mean horizontal / vertical image shift (fw/s). Positive = content moves right / down. */
  dx: number;
  dy: number;
  /** Isotropic divergence: relative scale change per second (>0 = expanding = moving forward). */
  div: number;
  /** Rotation of the image content, rad/s (>0 = clockwise on screen). */
  rot: number;
  /** Horizontal parallax: dx(top) − dx(bottom) (fw/s). Orbit signature. */
  px: number;
  /** Vertical parallax: dy(bottom) − dy(top) beyond uniform zoom (fw/s). Ascend/descend signature. */
  py: number;
  /** How well a smooth affine motion model explains the flow, 0..1. */
  fit: number;
  /** Share of flow vectors aligned (cos > 0.8) with the mean vector, 0..1. */
  coherence: number;
  /** Variance of flow magnitude ((fw/s)²). */
  magVar: number;
  /** Variance of the Laplacian (sharpness) of the second frame. */
  sharpness: number;
  /** Mean luma 0..255 of the second frame. */
  brightness: number;
  /** Share of near-white (≥250) pixels. */
  overexposed: number;
}

/** Raw per-frame grayscale source. */
export interface FrameSourceInfo {
  width: number;
  height: number;
  /** Analysis frame rate. */
  fps: number;
  /** Expected frame count (for progress), if known. */
  expectedFrames?: number;
}

export interface AnalyzeOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Computes per-frame-pair motion features from a stream of grayscale frames.
 * Implementations: opencv-js in worker_threads (default); could be swapped for
 * a native or Python implementation without touching callers.
 */
export interface MotionAnalyzer {
  analyze(
    frames: AsyncIterable<Uint8Array>,
    info: FrameSourceInfo,
    opts?: AnalyzeOptions,
  ): Promise<FrameFeatures[]>;
}

export interface SegmentProposal {
  startSec: number;
  endSec: number;
  motionType: MotionType;
  score: number;
  reasons: string[];
}

export interface SegmentationResult {
  segments: SegmentProposal[];
  /** Smoothed per-sample motion class. */
  labels: MotionType[];
  /** Per-sample normalised speed 0..1 (for the timeline graph). */
  speed: number[];
  /** Per-sample smoothness 0..1 (for the timeline graph). */
  smoothness: number[];
}
