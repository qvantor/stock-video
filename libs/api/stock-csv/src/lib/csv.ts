import { stringify } from 'csv-stringify/sync';
import type { CsvClip, CsvContext, CsvIssue, StockCsvAdapter } from './types.js';

export interface CsvFile {
  fileName: string;
  content: string;
  /** Issues per clip file name. */
  issues: Map<string, CsvIssue[]>;
}

/** One CSV per platform: exact header, one row per clip, RFC 4180 quoting, UTF-8. */
export const buildCsv = (adapter: StockCsvAdapter, clips: CsvClip[], ctx: CsvContext): CsvFile => {
  const issues = new Map<string, CsvIssue[]>();
  const rows = clips.map((clip) => {
    const result = adapter.toRow(clip, ctx);
    if (result.row.length !== adapter.header.length) {
      throw new Error(
        `${adapter.id}: row has ${result.row.length} columns, header has ${adapter.header.length}`,
      );
    }
    issues.set(clip.filename, result.issues);
    return result.row;
  });
  const content = stringify([[...adapter.header], ...rows], { quoted_string: false, eof: true });
  return { fileName: adapter.fileName(ctx), content, issues };
};
