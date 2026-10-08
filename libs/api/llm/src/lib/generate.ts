import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClipMetadata, GeoContext, StockCategories, TechContext } from '@dfs/contracts';
import { describeContext, describeHint } from './context.js';
import type { ChatMessage, ChatResponse, OllamaClient } from './ollama.js';
import { postprocessMetadata, type PostprocessRules } from './postprocess.js';
import { formatCategories, renderTemplate, type PromptTemplate } from './prompt.js';
import { buildResponseSchema, checkLimits, responseJsonSchema, type LlmLimits } from './schema.js';

export interface GenerateInput {
  clipId: string;
  /** Base64 JPEG frames (downscaled for the model). */
  images: string[];
  geo: GeoContext | null;
  tech: TechContext;
  hint: string | null;
  poiName: string | null;
  categories: StockCategories;
}

export interface GenerateOptions {
  client: OllamaClient;
  model: string;
  think: boolean;
  keepAlive: string;
  temperature: number;
  timeoutMs: number;
  prompt: PromptTemplate;
  limits: LlmLimits;
  rules: PostprocessRules;
  /** Where raw requests/responses are written (null = no logs). */
  logDir: string | null;
  /** Additional attempts after an invalid answer. */
  maxRetries?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  /** Post-processed metadata. */
  metadata: ClipMetadata;
  /** The accepted answer as returned by the model. */
  raw: ClipMetadata;
  attempts: number;
  promptVersion: string;
  model: string;
}

export class LlmValidationError extends Error {}

/** Builds the system + user messages for a clip. */
export const buildMessages = (
  input: GenerateInput,
  opts: Pick<GenerateOptions, 'prompt' | 'limits'>,
): ChatMessage[] => {
  const vars = {
    titleMax: opts.limits.titleMax,
    descriptionMax: opts.limits.descriptionMax,
    keywordsMin: opts.limits.keywordsMin,
    keywordsMax: opts.limits.keywordsMax,
    categories: formatCategories(input.categories),
    context: describeContext(input.geo, input.tech),
    hint: describeHint(input.hint, input.poiName),
  };
  return [
    { role: 'system', content: renderTemplate(opts.prompt.system, vars) },
    { role: 'user', content: renderTemplate(opts.prompt.user, vars), images: input.images },
  ];
};

/** Model output sometimes comes wrapped in a Markdown code fence. */
const extractJson = (content: string): string => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  return (fenced?.[1] ?? content).trim();
};

const stripImages = (messages: ChatMessage[]) =>
  messages.map((m) =>
    m.images
      ? {
          ...m,
          images: m.images.map((i) => `<jpeg base64, ${Math.round((i.length * 3) / 4)} bytes>`),
        }
      : m,
  );

/**
 * Ask the model for metadata with a JSON Schema constrained answer. Invalid answers (schema or
 * limits) are retried with the error message appended; after the last retry an answer with only
 * soft issues (lengths) is accepted and fixed by post-processing, anything else fails.
 */
export const generateMetadata = async (
  input: GenerateInput,
  opts: GenerateOptions,
): Promise<GenerateResult> => {
  const schema = buildResponseSchema(input.categories);
  const format = responseJsonSchema(input.categories);
  const messages = buildMessages(input, opts);
  const maxAttempts = 1 + (opts.maxRetries ?? 2);
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    let response: ChatResponse | null = null;
    let errors: string[] = [];
    let accepted: ClipMetadata | null = null;
    try {
      response = await opts.client.chat(
        {
          model: opts.model,
          messages,
          format,
          think: opts.think,
          keepAlive: opts.keepAlive,
          temperature: opts.temperature,
        },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      const content = response.message.content;
      let json: unknown;
      try {
        json = JSON.parse(extractJson(content));
      } catch (err) {
        errors = [`the answer is not valid JSON (${(err as Error).message})`];
      }
      if (!errors.length) {
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          errors = parsed.error.issues.map((i) => `${i.path.join('.') || 'answer'}: ${i.message}`);
        } else {
          const issues = checkLimits(parsed.data, opts.limits);
          errors = issues.map((i) => i.message);
          const lastAttempt = attempt === maxAttempts;
          if (!issues.length || (lastAttempt && issues.every((i) => !i.hard)))
            accepted = parsed.data;
        }
      }
    } finally {
      await writeLog(opts.logDir, input.clipId, attempt, {
        model: opts.model,
        promptVersion: opts.prompt.version,
        attempt,
        durationMs: Date.now() - started,
        request: {
          messages: stripImages(messages),
          format,
          think: opts.think,
          temperature: opts.temperature,
        },
        response,
        errors,
      });
    }

    if (accepted) {
      return {
        metadata: postprocessMetadata(accepted, opts.limits, opts.rules),
        raw: accepted,
        attempts: attempt,
        promptVersion: opts.prompt.version,
        model: opts.model,
      };
    }
    lastErrors = errors;
    messages.push(
      { role: 'assistant', content: response?.message.content ?? '' },
      {
        role: 'user',
        content:
          `Your previous answer is invalid:\n- ${errors.join('\n- ')}\n` +
          'Fix these problems and return the complete corrected JSON only.',
      },
    );
  }
  throw new LlmValidationError(
    `The model returned invalid metadata ${maxAttempts} times: ${lastErrors.join('; ')}`,
  );
};

const writeLog = async (dir: string | null, clipId: string, attempt: number, data: unknown) => {
  if (!dir) return;
  try {
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(
      path.join(dir, `${clipId}_${stamp}_a${attempt}.json`),
      JSON.stringify(data, null, 2),
    );
  } catch {
    // Logging must never break generation.
  }
};
