import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROMPTS_DIR } from '@dfs/llm';
import { DEFAULT_CONFIG_DIR } from '@dfs/stock-csv';

export interface AssetDirs {
  promptsDir: string;
  stockConfigDir: string;
}

/**
 * Prompt templates and stock platform configs are plain files so they can be edited without a
 * code change. The production bundle gets copies next to main.js; from source they are read
 * directly from the libraries.
 */
export const resolveAssets = (bundleDir?: string): AssetDirs => {
  const pick = (name: string, fallback: string) => {
    const candidate = bundleDir ? path.join(bundleDir, name) : null;
    return candidate && fs.existsSync(candidate) ? candidate : fallback;
  };
  return {
    promptsDir: pick('prompts', DEFAULT_PROMPTS_DIR),
    stockConfigDir: pick('stock-config', DEFAULT_CONFIG_DIR),
  };
};
