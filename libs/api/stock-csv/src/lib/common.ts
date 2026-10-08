import type { CsvClip, CsvIssue } from './types.js';
import { collapse, truncateAtWord, truncateText } from './text.js';

export interface MediaLimits {
  minDurationSec: number;
  maxDurationSec: number;
  maxFileSizeBytes: number;
}

/** Duration and file size against the platform limits. */
export const mediaIssues = (clip: CsvClip, limits: MediaLimits): CsvIssue[] => {
  const issues: CsvIssue[] = [];
  const d = clip.tech.durationSec;
  if (d < limits.minDurationSec) {
    issues.push({
      level: 'error',
      message: `Clip is ${d.toFixed(1)} s, the minimum is ${limits.minDurationSec} s`,
    });
  } else if (d > limits.maxDurationSec) {
    issues.push({
      level: 'error',
      message: `Clip is ${d.toFixed(1)} s, the maximum is ${limits.maxDurationSec} s`,
    });
  }
  if (clip.outputSizeBytes !== null && clip.outputSizeBytes > limits.maxFileSizeBytes) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(2);
    issues.push({
      level: 'error',
      message: `File is ${gb(clip.outputSizeBytes)} GB, the limit is ${gb(limits.maxFileSizeBytes)} GB`,
    });
  }
  return issues;
};

/** Trim a field to a limit, recording a warning when text was cut. */
export const fit = (
  value: string,
  max: number,
  field: string,
  issues: CsvIssue[],
  mode: 'word' | 'sentence' = 'word',
): string => {
  const clean = collapse(value);
  if (clean.length <= max) return clean;
  issues.push({
    level: 'warning',
    message: `${field} shortened from ${clean.length} to ${max} characters`,
  });
  return mode === 'sentence' ? truncateText(clean, max) : truncateAtWord(clean, max);
};

/** Keywords are joined with commas: a comma, semicolon or quote inside one keyword would break it. */
export const csvKeywords = (keywords: string[]): string[] => {
  const seen = new Set<string>();
  return keywords
    .map((k) => collapse(k.replace(/[,;"]+/g, ' ')))
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
};

/** Keyword list limited to `max`, with a warning when cut and an error below `min`. */
export const limitKeywords = (
  keywords: string[],
  min: number,
  max: number,
  issues: CsvIssue[],
): string[] => {
  if (csvKeywords(keywords).length > max) {
    issues.push({
      level: 'warning',
      message: `${keywords.length} keywords, only the first ${max} are used`,
    });
  }
  const out = csvKeywords(keywords).slice(0, max);
  if (out.length < min)
    issues.push({
      level: 'error',
      message: `${out.length} keywords, at least ${min} are required`,
    });
  return out;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Capture date (yyyy-mm-dd) as parts, or null. */
export const captureParts = (clip: CsvClip): { y: string; m: string; d: string } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clip.tech.captureDate ?? '');
  return m ? { y: m[1] as string, m: m[2] as string, d: m[3] as string } : null;
};

export const ymdParts = (date: Date) => ({
  y: String(date.getFullYear()),
  m: pad(date.getMonth() + 1),
  d: pad(date.getDate()),
});
