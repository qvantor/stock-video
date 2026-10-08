import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StockCategories } from '@dfs/contracts';

export const PROMPT_VERSION = 'metadata.v1';

/** `libs/api/llm/prompts` when running from source; the API passes its bundled copy. */
export const DEFAULT_PROMPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prompts',
);

const SPLIT = '=== USER ===';

export interface PromptTemplate {
  version: string;
  system: string;
  user: string;
}

export const loadPrompt = (version = PROMPT_VERSION, dir = DEFAULT_PROMPTS_DIR): PromptTemplate => {
  const text = fs
    .readFileSync(path.join(dir, `${version}.md`), 'utf8')
    .replace(/<!--[\s\S]*?-->\s*/g, '');
  const [system, user] = text.split(SPLIT);
  if (!system || user === undefined)
    throw new Error(`Prompt ${version} has no "${SPLIT}" separator`);
  return { version, system: system.trim(), user: user.trim() };
};

export const renderTemplate = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));

export const formatCategories = (c: StockCategories): string =>
  [
    `Adobe Stock (adobeCategory, number): ${c.adobe.map((a) => `${a.id} = ${a.label}`).join('; ')}`,
    `Shutterstock (shutterstockCategories, 1–2 values): ${c.shutterstock.join('; ')}`,
    `Envato (envatoCategory, one value): ${c.envato.join('; ')}`,
  ].join('\n');
