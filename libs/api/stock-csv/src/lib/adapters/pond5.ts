import type { StockConfig } from '../config.js';
import { captureParts, fit, limitKeywords, mediaIssues, ymdParts } from '../common.js';
import { collapse, transliterate } from '../text.js';
import type { CsvClip, CsvIssue, StockCsvAdapter } from '../types.js';

/** Readable replacements for forbidden characters; anything else forbidden is removed. */
const REPLACEMENTS: Record<string, string> = {
  '&': ' and ',
  '%': ' percent',
  '@': ' at ',
  '/': ' ',
  '\\': ' ',
};

/** Pond5 rejects special characters and quotes: transliterate (é → e), then strip the forbidden set. */
export const pond5Sanitize = (text: string, forbidden: string): string => {
  const set = new Set([...forbidden]);
  const replaced = [...text]
    .map((ch) => (set.has(ch) && REPLACEMENTS[ch] !== undefined ? REPLACEMENTS[ch] : ch))
    .join('');
  const ascii = [...transliterate(replaced)].map((ch) => (set.has(ch) ? '' : ch)).join('');
  return collapse(ascii.replace(/[^\x20-\x7e]/g, ' ')).replace(/\s+([,.;:!])/g, '$1');
};

/**
 * Editorial captions: "City, Country YYYY/MM/DD: factual description". The slashes of the date are
 * part of Pond5's editorial format, so the prefix is added after sanitising.
 */
export const editorialPrefix = (
  clip: CsvClip,
  fallback: Date,
  clean: (s: string) => string,
): string => {
  const place = [clip.geo?.city, clip.geo?.country]
    .filter(Boolean)
    .map((p) => clean(p as string))
    .join(', ');
  const parts = captureParts(clip) ?? ymdParts(fallback);
  const date = `${parts.y}/${parts.m}/${parts.d}`;
  return place ? `${place} ${date}: ` : `${date}: `;
};

/** Pond5 metadata CSV. */
export const pond5Adapter = (stock: StockConfig): StockCsvAdapter => {
  const cfg = stock.pond5;
  const clean = (s: string | null | undefined) => pond5Sanitize(s ?? '', cfg.forbiddenCharacters);
  return {
    id: 'pond5',
    label: cfg.label,
    lastVerified: cfg.lastVerified,
    verified: cfg.verified,
    header: cfg.header,
    fileName: () => 'pond5.csv',

    toRow: (clip, { settings, exportDate }) => {
      const issues: CsvIssue[] = [...mediaIssues(clip, cfg.limits)];
      const prefix = clip.editorial ? editorialPrefix(clip, exportDate, clean) : '';
      const title = fit(prefix + clean(clip.metadata.title), cfg.limits.titleMax, 'Title', issues);
      const description = fit(
        prefix + clean(clip.metadata.description),
        cfg.limits.descriptionMax,
        'Description',
        issues,
        'sentence',
      );
      const keywords = limitKeywords(
        clip.metadata.keywords.map(clean),
        cfg.limits.keywordsMin,
        cfg.limits.keywordsMax,
        issues,
      );
      let date = captureParts(clip);
      if (!date) {
        date = ymdParts(exportDate);
        issues.push({
          level: 'warning',
          message: 'Capture date unknown: the export date is used for datecreated',
        });
      }
      const row = [
        clip.filename,
        title,
        description,
        keywords.join(','),
        clean(clip.geo?.city),
        clean(clip.geo?.region),
        clean(clip.geo?.country),
        clean(clip.tech.droneModel),
        'no', // containsaudio: the cut step strips audio (-an)
        '',
        clean(settings.copyright),
        String(settings.pond5Price),
        String(settings.pond5PriceLarge),
        clip.editorial ? 'yes' : 'no',
        `${date.m}/${date.d}/${date.y}`,
      ];
      return { row, issues };
    },
  };
};
