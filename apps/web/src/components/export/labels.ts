import type { ClipStatus, ExportClip, ShotType, TimeOfDay } from '@dfs/contracts';

const CLIP_STATUS_LABEL: Record<ClipStatus, string> = {
  queued: 'Queued',
  frames: 'Extracting frames',
  geo: 'Locating',
  tech: 'Analysing',
  llm: 'Writing metadata',
  review: 'Needs review',
  cut: 'Encoding',
  done: 'Done',
  failed: 'Failed',
};

export const SHOT_LABEL: Record<ShotType, string> = {
  real_time: 'Real time',
  slow_motion: 'Slow motion',
  high_frame_rate: 'High frame rate',
  timelapse: 'Timelapse',
  hyperlapse: 'Hyperlapse',
};

export const TIME_LABEL: Record<TimeOfDay, string> = {
  sunrise: 'Sunrise',
  golden_hour: 'Golden hour',
  day: 'Day',
  sunset: 'Sunset',
  blue_hour: 'Blue hour',
  night: 'Night',
};

const STATUS_TONE: Record<ClipStatus, string> = {
  queued: 'text-neutral-400',
  frames: 'text-sky-300',
  geo: 'text-sky-300',
  tech: 'text-sky-300',
  llm: 'text-violet-300',
  review: 'text-amber-300',
  cut: 'text-sky-300',
  done: 'text-emerald-400',
  failed: 'text-red-400',
};

/** Approved but still queued behind other clips: the status flips to `cut` once a slot frees. */
export const isAwaitingCut = (c: Pick<ExportClip, 'status' | 'approved' | 'excluded'>): boolean =>
  c.status === 'review' && c.approved && !c.excluded;

export const clipStatusLabel = (c: ExportClip): string => {
  if (c.excluded) return 'Excluded';
  if (isAwaitingCut(c)) return 'Approved · waiting for encoding';
  return CLIP_STATUS_LABEL[c.status];
};

export const clipStatusTone = (c: ExportClip): string =>
  isAwaitingCut(c) ? STATUS_TONE.cut : STATUS_TONE[c.status];

export const KEYWORD_LIMIT = 50;
