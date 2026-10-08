import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { StockCategories } from '@dfs/contracts';

const Meta = {
  platform: z.string(),
  label: z.string(),
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verified: z.boolean(),
  source: z.string(),
  header: z.array(z.string()).min(1),
};

const DurationLimits = {
  minDurationSec: z.number().positive(),
  maxDurationSec: z.number().positive(),
  maxFileSizeBytes: z.number().int().positive(),
};

export const AdobeConfigSchema = z.object({
  ...Meta,
  limits: z.object({
    titleMax: z.number().int().positive(),
    keywordsMax: z.number().int().positive(),
    keywordsMin: z.number().int().nonnegative(),
    ...DurationLimits,
  }),
  categories: z.array(z.object({ id: z.number().int(), label: z.string() })).min(1),
});

export const ShutterstockConfigSchema = z.object({
  ...Meta,
  limits: z.object({
    descriptionMax: z.number().int().positive(),
    keywordsMax: z.number().int().positive(),
    keywordsMin: z.number().int().nonnegative(),
    ...DurationLimits,
  }),
  categories: z.array(z.string()).min(1),
});

export const Pond5ConfigSchema = z.object({
  ...Meta,
  limits: z.object({
    titleMax: z.number().int().positive(),
    descriptionMax: z.number().int().positive(),
    keywordsMin: z.number().int().nonnegative(),
    keywordsMax: z.number().int().positive(),
    ...DurationLimits,
  }),
  forbiddenCharacters: z.string(),
});

export const EnvatoConfigSchema = z.object({
  ...Meta,
  limits: z.object({
    titleMax: z.number().int().positive(),
    keywordsMax: z.number().int().positive(),
    keywordMaxLength: z.number().int().positive(),
    keywordsFieldMax: z.number().int().positive(),
    ...DurationLimits,
  }),
  /** Split "wooden church" into "wooden", "church" if Envato rejects spaces in keywords. */
  splitMultiwordKeywords: z.boolean(),
  categories: z.array(z.string()).min(1),
  movement: z.array(z.string()),
  pace: z.record(z.string(), z.string()),
});

export const CommonConfigSchema = z.object({
  lastVerified: z.string(),
  llm: z.object({
    titleMax: z.number().int().positive(),
    descriptionMax: z.number().int().positive(),
    keywordsMin: z.number().int().positive(),
    keywordsMax: z.number().int().positive(),
    keywordsHardMin: z.number().int().positive(),
  }),
  technicalTerms: z.array(z.string()),
  brandNames: z.array(z.string()),
  fillerWords: z.array(z.string()),
});

export type AdobeConfig = z.infer<typeof AdobeConfigSchema>;
export type ShutterstockConfig = z.infer<typeof ShutterstockConfigSchema>;
export type Pond5Config = z.infer<typeof Pond5ConfigSchema>;
export type EnvatoConfig = z.infer<typeof EnvatoConfigSchema>;
export type CommonConfig = z.infer<typeof CommonConfigSchema>;

export interface StockConfig {
  adobe: AdobeConfig;
  shutterstock: ShutterstockConfig;
  pond5: Pond5Config;
  envato: EnvatoConfig;
  common: CommonConfig;
}

/** `libs/api/stock-csv/config` when running from source; the API passes its bundled copy. */
export const DEFAULT_CONFIG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../config',
);

const read = <T>(dir: string, name: string, schema: z.ZodType<T>): T => {
  const file = path.join(dir, `${name}.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read stock config ${file}: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`Invalid stock config ${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
};

/** Load and validate every platform config (categories, limits, last verification date). */
export const loadStockConfig = (dir = DEFAULT_CONFIG_DIR): StockConfig => ({
  adobe: read(dir, 'adobe', AdobeConfigSchema),
  shutterstock: read(dir, 'shutterstock', ShutterstockConfigSchema),
  pond5: read(dir, 'pond5', Pond5ConfigSchema),
  envato: read(dir, 'envato', EnvatoConfigSchema),
  common: read(dir, 'common', CommonConfigSchema),
});

/** Category lists given to the model as enums. */
export const stockCategories = (config: StockConfig): StockCategories => ({
  adobe: config.adobe.categories,
  shutterstock: config.shutterstock.categories,
  envato: config.envato.categories,
});
