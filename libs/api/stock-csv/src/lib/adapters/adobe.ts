import type { StockConfig } from '../config.js';
import { fit, limitKeywords, mediaIssues, ymdParts } from '../common.js';
import { slugify } from '../text.js';
import type { CsvIssue, StockCsvAdapter } from '../types.js';

/** Adobe Stock: Filename, Title, Keywords, Category, Releases. */
export const adobeAdapter = (stock: StockConfig): StockCsvAdapter => {
  const cfg = stock.adobe;
  const ids = new Set(cfg.categories.map((c) => c.id));
  return {
    id: 'adobe',
    label: cfg.label,
    lastVerified: cfg.lastVerified,
    verified: cfg.verified,
    header: cfg.header,

    fileName: ({ settings, exportDate }) => {
      const { y, m, d } = ymdParts(exportDate);
      return `adobe_stock_${slugify(settings.adobeAuthor) || 'author'}_${y}_${m}_${d}.csv`;
    },

    toRow: (clip) => {
      const issues: CsvIssue[] = [...mediaIssues(clip, cfg.limits)];
      const title = fit(clip.metadata.title, cfg.limits.titleMax, 'Title', issues);
      const keywords = limitKeywords(
        clip.metadata.keywords,
        cfg.limits.keywordsMin,
        cfg.limits.keywordsMax,
        issues,
      );
      if (!ids.has(clip.metadata.adobeCategory)) {
        issues.push({
          level: 'error',
          message: `Unknown Adobe category ${clip.metadata.adobeCategory}`,
        });
      }
      if (clip.editorial) {
        issues.push({
          level: 'warning',
          message:
            'Marked editorial: Adobe Stock video editorial content is limited, check the submission rules',
        });
      }
      return {
        row: [clip.filename, title, keywords.join(', '), String(clip.metadata.adobeCategory), ''],
        issues,
      };
    },
  };
};
