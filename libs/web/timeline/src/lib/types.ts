import type { MotionType, SpriteMeta } from '@dfs/contracts';

export interface TimelineSegment {
  id: string;
  startSec: number;
  endSec: number;
  motionType: MotionType;
  accepted: boolean;
  /** Validation message; highlighted when present. */
  warning?: string;
}

export interface TimelineMetrics {
  /** Sample rate of the series. */
  fps: number;
  t: readonly number[];
  speed: readonly number[];
  smoothness: readonly number[];
  motion?: readonly MotionType[];
}

export interface TimelineSprite {
  url: string;
  meta: SpriteMeta;
}

export interface BoundsChange {
  id: string;
  startSec: number;
  endSec: number;
}

export type SelectMode = 'replace' | 'toggle' | 'add';

export interface TimelineProps {
  duration: number;
  /** Source frame rate (snapping grid). */
  fps: number;
  currentTime: number;
  onSeek: (t: number) => void;
  segments: readonly TimelineSegment[];
  selectedIds: ReadonlySet<string>;
  onSelect: (ids: string[], mode: SelectMode) => void;
  /** Called once per finished drag/resize. Omit for read-only. */
  onChangeBounds?: (changes: BoundsChange[]) => void;
  /** Drag over empty space creates a segment. Omit to disable. */
  onCreate?: (startSec: number, endSec: number) => void;
  /**
   * Called with the time of the edge under the pointer while resizing or creating a segment,
   * and with `null` when the drag ends.
   */
  onPreview?: (t: number | null) => void;
  sprite?: TimelineSprite | null;
  metrics?: TimelineMetrics | null;
  inPoint?: number | null;
  outPoint?: number | null;
  /** Keep the playhead in view (while playing). */
  followPlayhead?: boolean;
  className?: string;
}
