import type { StockConfig } from '../config.js';
import { fit, limitKeywords, mediaIssues } from '../common.js';
import { collapse } from '../text.js';
import type { CsvIssue, StockCsvAdapter } from '../types.js';

/** Title and description in one field: both if they fit, otherwise the title. */
export const shutterstockDescription = (
  title: string,
  description: string,
  max: number,
): string => {
  const t = collapse(title).replace(/[.\s]+$/, '');
  const combined = `${t}. ${collapse(description)}`;
  return combined.length <= max ? combined : t;
};

/** Shutterstock: Filename, Description, Keywords, Categories, Editorial. */
export const shutterstockAdapter = (stock: StockConfig): StockCsvAdapter => {
  const cfg = stock.shutterstock;
  const allowed = new Set(cfg.categories);
  return {
    id: 'shutterstock',
    label: cfg.label,
    lastVerified: cfg.lastVerified,
    verified: cfg.verified,
    header: cfg.header,
    fileName: () => 'shutterstock.csv',

    toRow: (clip) => {
      const issues: CsvIssue[] = [...mediaIssues(clip, cfg.limits)];
      const description = fit(
        shutterstockDescription(
          clip.metadata.title,
          clip.metadata.description,
          cfg.limits.descriptionMax,
        ),
        cfg.limits.descriptionMax,
        'Description',
        issues,
      );
      const keywords = limitKeywords(
        clip.metadata.keywords,
        cfg.limits.keywordsMin,
        cfg.limits.keywordsMax,
        issues,
      );
      const categories = clip.metadata.shutterstockCategories
        .filter((c) => allowed.has(c))
        .slice(0, 2);
      if (categories.length !== clip.metadata.shutterstockCategories.length || !categories.length) {
        issues.push({
          level: 'error',
          message: 'Shutterstock categories must be 1–2 values from the official list',
        });
      }
      return {
        row: [
          clip.filename,
          description,
          keywords.join(','),
          categories.join(','),
          clip.editorial ? 'Yes' : 'No',
        ],
        issues,
      };
    },
  };
};
