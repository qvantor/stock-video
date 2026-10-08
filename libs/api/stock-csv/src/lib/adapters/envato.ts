import type { StockConfig } from '../config.js';
import { fit, mediaIssues } from '../common.js';
import { collapse, transliterate } from '../text.js';
import type { CsvIssue, StockCsvAdapter } from '../types.js';

export interface EnvatoKeywordRules {
  max: number;
  maxLength: number;
  fieldMax: number;
  splitMultiword: boolean;
}

/**
 * Envato keywords: only a-z A-Z 0-9 and "." (spaces inside multi-word tags unless splitting is
 * enabled), max 100 characters each, not digits only, not starting with ".", 50 tags, 2048 chars.
 */
export const envatoKeywords = (keywords: string[], rules: EnvatoKeywordRules): string[] => {
  const tokens = keywords.flatMap((k) => {
    const clean = collapse(transliterate(k).replace(/[^A-Za-z0-9. ]+/g, ' ')).replace(/^\.+/, '');
    return rules.splitMultiword ? clean.split(' ') : [clean];
  });
  const seen = new Set<string>();
  const out: string[] = [];
  let length = 0;
  for (const raw of tokens) {
    const k = raw.trim().replace(/^\.+/, '').slice(0, rules.maxLength).trim();
    if (!k || /^[\d.]+$/.test(k) || seen.has(k.toLowerCase())) continue;
    const added = (out.length ? 1 : 0) + k.length;
    if (length + added > rules.fieldMax) break;
    seen.add(k.toLowerCase());
    out.push(k);
    length += added;
    if (out.length >= rules.max) break;
  }
  return out;
};

const price = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Envato Stock Video (Portfolio Manager) CSV. */
export const envatoAdapter = (stock: StockConfig): StockCsvAdapter => {
  const cfg = stock.envato;
  const categories = new Set(cfg.categories);
  const movementAllowed = new Set(cfg.movement);
  return {
    id: 'envato',
    label: cfg.label,
    lastVerified: cfg.lastVerified,
    verified: cfg.verified,
    header: cfg.header,
    fileName: () => 'envato.csv',

    toRow: (clip, { settings }) => {
      const issues: CsvIssue[] = [...mediaIssues(clip, cfg.limits)];
      const title = fit(clip.metadata.title, cfg.limits.titleMax, 'Title', issues);
      const keywords = envatoKeywords(clip.metadata.keywords, {
        max: cfg.limits.keywordsMax,
        maxLength: cfg.limits.keywordMaxLength,
        fieldMax: cfg.limits.keywordsFieldMax,
        splitMultiword: cfg.splitMultiwordKeywords,
      });
      if (keywords.length < Math.min(clip.metadata.keywords.length, cfg.limits.keywordsMax)) {
        issues.push({
          level: 'warning',
          message: 'Some keywords were dropped by the Envato keyword rules',
        });
      }
      if (!categories.has(clip.metadata.envatoCategory)) {
        issues.push({
          level: 'error',
          message: `Unknown Envato category "${clip.metadata.envatoCategory}"`,
        });
      }
      const movement = clip.tech.movement.filter((m) => movementAllowed.has(m));
      const row = [
        clip.filename,
        title,
        collapse(clip.metadata.description),
        keywords.join(','),
        clip.metadata.envatoCategory,
        price(settings.envatoPriceSingle),
        price(settings.envatoPriceMulti),
        'No',
        clip.metadata.recognizableBuildings ? 'Yes' : 'No',
        '',
        '',
        'Full Color',
        cfg.pace[clip.tech.shotType] ?? 'Real Time',
        movement.join(','),
        'Wide Shot',
        'Outdoors',
        // Optional: No. of People, Gender, Age, Ethnicity, Alpha Channel, Looped, Source Audio
        ...Array<string>(7).fill(''),
      ];
      return { row, issues };
    },
  };
};
