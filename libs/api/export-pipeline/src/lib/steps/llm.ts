import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMetadata } from '@dfs/llm';
import { stockCategories } from '@dfs/stock-csv';
import { hashOf } from '../hash.js';
import type { PipelineStep } from '../types.js';
import type { StepDeps } from './deps.js';
import { frameFile } from './frames.js';

/** Metadata generation with the local model (always one request at a time). */
export const llmStep = (deps: StepDeps): PipelineStep => ({
  name: 'llm',

  hash: ({ clip, settings }) =>
    hashOf(
      'llm.v1',
      deps.prompt.version,
      settings.model,
      settings.think,
      settings.temperature,
      clip.stepHashes.frames,
      clip.geo,
      clip.tech,
      clip.userHint,
      clip.poiOverride,
      stockCategories(deps.stock),
    ),

  isComplete: (clip) => clip.metadata !== null && clip.generation !== null,

  run: async ({ clip, settings, signal, log }) => {
    if (!clip.frames?.length || !clip.tech)
      throw new Error('Frames and technical context are missing');
    const client = deps.ollama(settings.ollamaUrl);
    const health = await client.health(settings.model);
    if (!health.ok) throw new Error(health.message ?? 'Ollama is not available');

    const dir = deps.clipDir(clip.jobId, clip.id);
    const images = await Promise.all(
      clip.frames.map(async (f) =>
        (await fs.readFile(path.join(dir, frameFile(f.index, 'llm')))).toString('base64'),
      ),
    );
    const result = await generateMetadata(
      {
        clipId: clip.id,
        images,
        geo: clip.geo,
        tech: clip.tech,
        hint: clip.userHint,
        poiName: clip.poiOverride,
        categories: stockCategories(deps.stock),
      },
      {
        client,
        model: settings.model,
        think: settings.think,
        keepAlive: settings.keepAlive,
        temperature: settings.temperature,
        timeoutMs: settings.llmTimeoutSec * 1000,
        prompt: deps.prompt,
        limits: deps.stock.common.llm,
        rules: deps.stock.common,
        logDir: deps.llmLogDir,
        signal,
      },
    );
    log.info(
      { clipId: clip.id, attempts: result.attempts, model: result.model },
      'metadata generated',
    );
    return {
      metadata: result.metadata,
      // A new answer resets the user's editorial override to the model's suggestion.
      editorial: null,
      generation: {
        model: result.model,
        promptVersion: result.promptVersion,
        attempts: result.attempts,
        generatedAt: new Date().toISOString(),
        raw: result.raw,
      },
    };
  },
});
