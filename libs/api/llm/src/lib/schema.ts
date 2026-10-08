import { z } from 'zod';
import { PLACE_CONFIDENCE, type ClipMetadata, type StockCategories } from '@dfs/contracts';

export interface LlmLimits {
  titleMax: number;
  descriptionMax: number;
  keywordsMin: number;
  keywordsMax: number;
  /** Fewer keywords than this is never accepted. */
  keywordsHardMin: number;
}

/**
 * Structure of the model answer with the category lists as enums. Used both as the Ollama
 * `format` (JSON Schema → constrained decoding) and to validate the answer.
 * Lengths are not part of the schema (constrained decoding would cut words); they are checked
 * separately so the model can be asked to fix them.
 */
export const buildResponseSchema = (categories: StockCategories) => {
  const adobeIds = categories.adobe.map((c) => c.id) as [number, ...number[]];
  return z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
      keywords: z.array(z.string().min(1)).min(1),
      subject: z.string().min(1),
      placeConfidence: z.enum(PLACE_CONFIDENCE),
      adobeCategory: z.literal(adobeIds),
      shutterstockCategories: z
        .array(z.enum(categories.shutterstock as [string, ...string[]]))
        .min(1)
        .max(2),
      envatoCategory: z.enum(categories.envato as [string, ...string[]]),
      recognizableBuildings: z.boolean(),
      editorialSuggested: z.boolean(),
      editorialReason: z.string().nullable(),
    })
    .strict();
};

export const responseJsonSchema = (categories: StockCategories): Record<string, unknown> => {
  const schema = z.toJSONSchema(buildResponseSchema(categories)) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
};

export interface LimitIssue {
  message: string;
  /** Hard issues are never accepted; soft ones are fixed by post-processing after the last retry. */
  hard: boolean;
}

/** Length / count checks the model is asked to fix. */
export const checkLimits = (m: ClipMetadata, limits: LlmLimits): LimitIssue[] => {
  const issues: LimitIssue[] = [];
  if (m.title.length > limits.titleMax) {
    issues.push({
      message: `title is ${m.title.length} characters, the maximum is ${limits.titleMax}`,
      hard: false,
    });
  }
  if (m.description.length > limits.descriptionMax) {
    issues.push({
      message: `description is ${m.description.length} characters, the maximum is ${limits.descriptionMax}`,
      hard: false,
    });
  }
  const unique = new Set(m.keywords.map((k) => k.trim().toLowerCase())).size;
  if (unique < limits.keywordsHardMin) {
    issues.push({
      message: `only ${unique} unique keywords, at least ${limits.keywordsMin} are required`,
      hard: true,
    });
  } else if (unique < limits.keywordsMin) {
    issues.push({
      message: `only ${unique} unique keywords, at least ${limits.keywordsMin} are required`,
      hard: false,
    });
  }
  if (m.keywords.length > limits.keywordsMax) {
    issues.push({
      message: `${m.keywords.length} keywords, the maximum is ${limits.keywordsMax}`,
      hard: false,
    });
  }
  if (m.editorialSuggested && !m.editorialReason?.trim()) {
    issues.push({
      message: 'editorialSuggested is true but editorialReason is empty',
      hard: false,
    });
  }
  return issues;
};
