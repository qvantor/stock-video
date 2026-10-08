import type { GeoService } from '@dfs/geo';
import type { OllamaClient, PromptTemplate } from '@dfs/llm';
import type { StockConfig } from '@dfs/stock-csv';
import type { VideoSource } from '../types.js';

/** Dependencies of the real step implementations. */
export interface StepDeps {
  ffmpegPath: string;
  /** Working directory of a clip (frames, cut file). */
  clipDir: (jobId: string, clipId: string) => string;
  frameUrl: (clipId: string, index: number) => string;
  videos: VideoSource;
  geo: GeoService;
  /** Platform configs (category lists, limits, keyword rules). */
  stock: StockConfig;
  prompt: PromptTemplate;
  /** Ollama client for the configured URL. */
  ollama: (baseUrl: string) => OllamaClient;
  /** Directory for raw LLM request/response logs. */
  llmLogDir: string;
}
