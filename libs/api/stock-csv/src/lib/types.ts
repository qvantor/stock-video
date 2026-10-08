import type {
  ClipMetadata,
  ExportSettings,
  GeoContext,
  PlatformValidation,
  TechContext,
  ValidationLevel,
} from '@dfs/contracts';

/** Everything an adapter needs about one delivered clip. */
export interface CsvClip {
  /** Final delivery file name (identical in every CSV). */
  filename: string;
  metadata: ClipMetadata;
  /** Final editorial decision. */
  editorial: boolean;
  geo: GeoContext | null;
  tech: TechContext;
  /** Size of the encoded file, when it exists. */
  outputSizeBytes: number | null;
}

export interface CsvContext {
  settings: ExportSettings;
  /** Export time (used in file names and as a fallback date). */
  exportDate: Date;
}

export interface CsvIssue {
  level: Exclude<ValidationLevel, 'ok'>;
  message: string;
}

export interface CsvRowResult {
  row: string[];
  issues: CsvIssue[];
}

/** One stock platform: file name, header, row mapping and its own sanitising/limits. */
export interface StockCsvAdapter {
  readonly id: string;
  readonly label: string;
  readonly lastVerified: string;
  /** Whether the column layout was checked against the platform's official template. */
  readonly verified: boolean;
  readonly header: readonly string[];
  fileName(ctx: CsvContext): string;
  toRow(clip: CsvClip, ctx: CsvContext): CsvRowResult;
}

export const validationOf = (platform: string, issues: CsvIssue[]): PlatformValidation => ({
  platform,
  level: issues.some((i) => i.level === 'error') ? 'error' : issues.length ? 'warning' : 'ok',
  messages: issues.map((i) => i.message),
});
