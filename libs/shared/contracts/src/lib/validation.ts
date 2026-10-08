import type { AnalysisSettings } from './settings.js';
import type { Segment } from './segment.js';

export type SegmentIssueKind = 'too_short' | 'too_long' | 'overlap' | 'out_of_bounds';

export interface SegmentIssue {
  segmentId: string;
  kind: SegmentIssueKind;
  message: string;
}

/** Small tolerance so frame-rounding noise does not raise warnings. */
const EPS = 1e-3;

/**
 * Validate one video's segments. Only accepted segments are checked for
 * length and overlap — rejected ones never reach the manifest.
 */
export const validateSegments = (
  segments: readonly Segment[],
  settings: Pick<AnalysisSettings, 'minDuration' | 'maxDuration'>,
  durationSec: number | null,
): SegmentIssue[] => {
  const issues: SegmentIssue[] = [];
  const accepted = segments.filter((s) => s.accepted);
  for (const s of accepted) {
    const len = s.endSec - s.startSec;
    if (len < settings.minDuration - EPS) {
      issues.push({
        segmentId: s.id,
        kind: 'too_short',
        message: `Shorter than ${settings.minDuration} s (${len.toFixed(1)} s)`,
      });
    }
    if (len > settings.maxDuration + EPS) {
      issues.push({
        segmentId: s.id,
        kind: 'too_long',
        message: `Longer than ${settings.maxDuration} s (${len.toFixed(1)} s)`,
      });
    }
    if (durationSec !== null && (s.startSec < -EPS || s.endSec > durationSec + EPS)) {
      issues.push({
        segmentId: s.id,
        kind: 'out_of_bounds',
        message: 'Extends beyond the video',
      });
    }
  }
  const sorted = [...accepted].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.startSec < prev.endSec - EPS) {
      issues.push({
        segmentId: cur.id,
        kind: 'overlap',
        message: 'Overlaps an adjacent segment',
      });
      issues.push({
        segmentId: prev.id,
        kind: 'overlap',
        message: 'Overlaps an adjacent segment',
      });
    }
  }
  return issues;
};
