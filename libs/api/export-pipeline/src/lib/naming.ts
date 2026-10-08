import type { ClipMetadata, GeoContext, MotionType, TechContext } from '@dfs/contracts';
import { slugify } from '@dfs/stock-csv';

/** Maximum file name length, extension included (Pond5 and FTP friendly). */
export const MAX_FILENAME_LENGTH = 80;

const MOTION_SLUG: Record<MotionType, string> = {
  forward: 'forward',
  backward: 'reveal',
  pan_left: 'pan',
  pan_right: 'pan',
  tilt_up: 'tilt_up',
  tilt_down: 'tilt_down',
  orbit_left: 'orbit',
  orbit_right: 'orbit',
  ascend: 'ascend',
  descend: 'descend',
  static: 'hover',
  erratic: 'aerial',
};

export interface NamingInput {
  id: string;
  ordinal: number;
  motionType: MotionType;
  metadata: Pick<ClipMetadata, 'subject'> | null;
  geo: Pick<GeoContext, 'city' | 'region' | 'country'> | null;
  tech: Pick<TechContext, 'captureDate'> | null;
}

const trimToWords = (slug: string, max: number): string => {
  if (slug.length <= max) return slug;
  const parts = slug.split('_');
  while (parts.length > 1 && parts.join('_').length > max) parts.pop();
  return parts.join('_').slice(0, Math.max(0, max));
};

/**
 * `{subject}_{place}_{motion}_{date}_{n}` → only [a-z0-9_], no diacritics, ≤ 80 characters with the
 * extension. Subject and place are shortened word by word when the name is too long.
 */
export const renderFilename = (template: string, clip: NamingInput, ext: string): string => {
  const parts: Record<string, string> = {
    subject: slugify(clip.metadata?.subject ?? '') || 'aerial',
    place: slugify(clip.geo?.city ?? clip.geo?.region ?? clip.geo?.country ?? ''),
    motion: MOTION_SLUG[clip.motionType],
    date: (clip.tech?.captureDate ?? '').replace(/-/g, ''),
    n: String(clip.ordinal + 1).padStart(3, '0'),
  };
  const render = (p: Record<string, string>) =>
    slugify(template.replace(/\{(\w+)\}/g, (_m, key: string) => p[key] ?? '')).replace(/_+/g, '_');
  const budget = MAX_FILENAME_LENGTH - ext.length - 1;
  let name = render(parts);
  for (const key of ['place', 'subject'] as const) {
    if (name.length <= budget) break;
    const excess = name.length - budget;
    parts[key] = trimToWords(parts[key] ?? '', Math.max(0, (parts[key] ?? '').length - excess));
    name = render(parts);
  }
  name = name.slice(0, budget).replace(/_+$/, '') || 'clip';
  return `${name}.${ext}`;
};

/** Delivery names for every clip of a job; duplicates get a numeric suffix. */
export const assignFilenames = (
  clips: NamingInput[],
  template: string,
  ext: string,
): Map<string, string> => {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const clip of [...clips].sort((a, b) => a.ordinal - b.ordinal)) {
    const first = renderFilename(template, clip, ext);
    const base = first.slice(0, -(ext.length + 1));
    let name = first;
    for (let k = 2; used.has(name); k++) {
      const suffix = `_${k}`;
      name = `${base.slice(0, MAX_FILENAME_LENGTH - ext.length - 1 - suffix.length)}${suffix}.${ext}`;
    }
    used.add(name);
    out.set(clip.id, name);
  }
  return out;
};
