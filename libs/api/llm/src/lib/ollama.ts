import { z } from 'zod';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64-encoded images (no data: prefix). */
  images?: string[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** JSON Schema of the answer (structured output). */
  format?: Record<string, unknown>;
  think?: boolean;
  keepAlive?: string;
  temperature?: number;
}

const TagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), model: z.string().optional() }).loose()),
});

const ChatResponseSchema = z
  .object({
    model: z.string().optional(),
    message: z
      .object({ role: z.string(), content: z.string(), thinking: z.string().optional() })
      .loose(),
    done: z.boolean().optional(),
    total_duration: z.number().optional(),
    eval_count: z.number().optional(),
  })
  .loose();
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export class OllamaError extends Error {}

/** Same model name, ignoring an implicit ":latest" tag. */
const sameModel = (a: string, b: string) => a === b || a === `${b}:latest` || `${a}:latest` === b;

export interface OllamaHealthResult {
  ok: boolean;
  message: string | null;
}

/** Minimal Ollama HTTP client (`/api/tags`, `/api/chat`). */
export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetch: FetchFn;

  constructor(opts: { baseUrl: string; fetch?: FetchFn }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async listModels(): Promise<string[]> {
    const res = await this.fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new OllamaError(`Ollama responded with HTTP ${res.status}`);
    return TagsSchema.parse(await res.json()).models.map((m) => m.name);
  }

  /** Is Ollama reachable and the model pulled? Returns an actionable message otherwise. */
  async health(model: string): Promise<OllamaHealthResult> {
    let models: string[];
    try {
      models = await this.listModels();
    } catch (err) {
      return {
        ok: false,
        message:
          `Ollama is not reachable at ${this.baseUrl} (${(err as Error).message}). ` +
          'Start it with `ollama serve` (or the Ollama app) and check the Ollama URL in export settings.',
      };
    }
    if (!models.some((m) => sameModel(m, model))) {
      return {
        ok: false,
        message: `Model "${model}" is not installed in Ollama. Run: ollama pull ${model}`,
      };
    }
    return { ok: true, message: null };
  }

  async chat(
    req: ChatRequest,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ChatResponse> {
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const body = {
      model: req.model,
      messages: req.messages,
      stream: false,
      ...(req.format ? { format: req.format } : {}),
      ...(req.think !== undefined ? { think: req.think } : {}),
      ...(req.keepAlive ? { keep_alive: req.keepAlive } : {}),
      options: { temperature: req.temperature ?? 0.3 },
    };
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (timeout.aborted)
        throw new OllamaError(
          `Ollama did not answer within ${Math.round(opts.timeoutMs / 1000)} s`,
        );
      throw err;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint =
        res.status === 404 ? ` — is the model pulled? Run: ollama pull ${req.model}` : '';
      throw new OllamaError(
        `Ollama /api/chat failed with HTTP ${res.status}: ${text.slice(0, 500)}${hint}`,
      );
    }
    return ChatResponseSchema.parse(await res.json());
  }
}
