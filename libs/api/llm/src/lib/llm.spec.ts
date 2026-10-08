import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClipMetadata, TechContext } from '@dfs/contracts';
import { loadStockConfig, stockCategories } from '@dfs/stock-csv';
import { describeContext } from './context.js';
import {
  generateMetadata,
  LlmValidationError,
  type GenerateInput,
  type GenerateOptions,
} from './generate.js';
import { OllamaClient, type FetchFn } from './ollama.js';
import { truncateAtWord, truncateText } from '@dfs/stock-csv';
import { cleanKeywords, postprocessMetadata } from './postprocess.js';
import { loadPrompt, PROMPT_VERSION } from './prompt.js';
import { responseJsonSchema } from './schema.js';

const stock = loadStockConfig();
const categories = stockCategories(stock);
const limits = stock.common.llm;
const rules = stock.common;

const tech: TechContext = {
  durationSec: 20,
  sourceDurationSec: 20,
  fps: 29.97,
  outputFps: 29.97,
  width: 3840,
  height: 2160,
  resolutionLabel: '4K',
  codec: 'hevc',
  bitDepth: 10,
  colorTransfer: 'rec709',
  hasAudio: false,
  shotType: 'real_time',
  motionType: 'orbit_left',
  movement: ['Aerial', 'Drone', 'Arc'],
  timeOfDay: 'golden_hour',
  season: 'summer',
  capturedAt: '2024-07-14T18:30:00.000Z',
  captureDate: '2024-07-14',
  altitudeM: 120,
  droneModel: 'DJI Mini4 Pro',
};

const keywords = (n: number) =>
  Array.from({ length: n }, (_, i) => `keyword ${String.fromCharCode(97 + (i % 26))}${i}`);

const good: ClipMetadata = {
  title: 'Aerial Orbit Around Kizhi Pogost Wooden Church, Lake Onega, Russia',
  description:
    'Drone orbits the wooden churches of Kizhi island on Lake Onega at golden hour in summer.',
  keywords: ['kizhi pogost', 'wooden church', 'russia', ...keywords(37)],
  subject: 'wooden church',
  placeConfidence: 'high',
  adobeCategory: 2,
  shutterstockCategories: ['Buildings/Landmarks'],
  envatoCategory: 'Buildings',
  recognizableBuildings: true,
  editorialSuggested: false,
  editorialReason: null,
};

const input: GenerateInput = {
  clipId: 'clip-1',
  images: ['aGVsbG8='],
  geo: null,
  tech,
  hint: null,
  poiName: null,
  categories,
};

/** Fake Ollama answering /api/chat with the queued contents in order. */
const fakeOllama = (contents: string[]) => {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    if (url.endsWith('/api/tags'))
      return new Response(JSON.stringify({ models: [{ name: 'gemma4:31b' }] }));
    bodies.push(JSON.parse(String(init?.body)));
    const content = contents.shift() ?? '{}';
    return new Response(
      JSON.stringify({ model: 'gemma4:31b', message: { role: 'assistant', content }, done: true }),
    );
  };
  return { client: new OllamaClient({ baseUrl: 'http://ollama:11434/', fetch: fetchFn }), bodies };
};

const options = (client: OllamaClient, logDir: string | null = null): GenerateOptions => ({
  client,
  model: 'gemma4:31b',
  think: false,
  keepAlive: '30m',
  temperature: 0.3,
  timeoutMs: 10_000,
  prompt: loadPrompt(),
  limits,
  rules,
  logDir,
});

describe('prompt', () => {
  it('loads the versioned template and renders every placeholder', () => {
    const p = loadPrompt();
    expect(p.version).toBe(PROMPT_VERSION);
    expect(p.system).toContain('expert stock footage metadata writer');
    expect(p.system).not.toContain('<!--');
  });

  it('says explicitly when the location is unknown', () => {
    expect(describeContext(null, tech)).toContain('Location: UNKNOWN');
    expect(describeContext(null, tech)).toContain('orbiting around the subject');
  });

  it('puts category lists into the JSON schema as enums', () => {
    const schema = responseJsonSchema(categories) as {
      properties: Record<string, { enum?: unknown[]; items?: { enum?: unknown[] } }>;
    };
    expect(schema.properties['adobeCategory']?.enum).toHaveLength(21);
    expect(schema.properties['shutterstockCategories']?.items?.enum).toContain(
      'Buildings/Landmarks',
    );
    expect(schema.properties['envatoCategory']?.enum).toContain('Overhead');
  });
});

describe('OllamaClient.health', () => {
  it('reports an unreachable server', async () => {
    const client = new OllamaClient({
      baseUrl: 'http://nowhere:1',
      fetch: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const h = await client.health('gemma4:31b');
    expect(h.ok).toBe(false);
    expect(h.message).toContain('not reachable');
  });

  it('tells how to pull a missing model', async () => {
    const { client } = fakeOllama([]);
    expect(await client.health('gemma4:31b')).toEqual({ ok: true, message: null });
    expect((await client.health('llava:13b')).message).toContain('ollama pull llava:13b');
  });
});

describe('generateMetadata', () => {
  it('retries an invalid JSON answer with the error and accepts the corrected one', async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-llm-'));
    const { client, bodies } = fakeOllama(['{"title": "Aerial', JSON.stringify(good)]);
    const result = await generateMetadata(input, options(client, logDir));
    expect(result.attempts).toBe(2);
    expect(result.promptVersion).toBe('metadata.v1');
    expect(result.metadata.title).toBe(good.title);

    const first = bodies[0] as {
      format: unknown;
      stream: boolean;
      keep_alive: string;
      think: boolean;
      options: { temperature: number };
    };
    expect(first).toMatchObject({
      stream: false,
      keep_alive: '30m',
      think: false,
      options: { temperature: 0.3 },
    });
    expect(first.format).toBeTypeOf('object');
    const second = bodies[1] as { messages: { role: string; content: string }[] };
    expect(second.messages.at(-1)?.content).toContain('not valid JSON');
    expect(second.messages.at(-2)?.role).toBe('assistant');

    const logs = fs.readdirSync(logDir);
    expect(logs).toHaveLength(2);
    expect(fs.readFileSync(path.join(logDir, logs[0] ?? ''), 'utf8')).toContain('<jpeg base64');
    fs.rmSync(logDir, { recursive: true });
  });

  it('retries categories outside the list', async () => {
    const { client, bodies } = fakeOllama([
      JSON.stringify({ ...good, envatoCategory: 'Aerial' }),
      JSON.stringify(good),
    ]);
    const result = await generateMetadata(input, options(client));
    expect(result.attempts).toBe(2);
    expect((bodies[1] as { messages: { content: string }[] }).messages.at(-1)?.content).toContain(
      'envatoCategory',
    );
  });

  it('fails after the retries are exhausted', async () => {
    const { client } = fakeOllama(['nope', 'still nope', '{"broken"']);
    await expect(generateMetadata(input, options(client))).rejects.toBeInstanceOf(
      LlmValidationError,
    );
  });

  it('accepts soft limit violations on the last attempt and trims them', async () => {
    const long = { ...good, title: `${good.title} and Surrounding Islands at Sunset` };
    const { client } = fakeOllama([
      JSON.stringify(long),
      JSON.stringify(long),
      JSON.stringify(long),
    ]);
    const result = await generateMetadata(input, options(client));
    expect(result.attempts).toBe(3);
    expect(result.raw.title.length).toBeGreaterThan(70);
    expect(result.metadata.title.length).toBeLessThanOrEqual(70);
  });

  it('never accepts too few keywords', async () => {
    const few = JSON.stringify({ ...good, keywords: ['church', 'aerial'] });
    const { client } = fakeOllama([few, few, few]);
    await expect(generateMetadata(input, options(client))).rejects.toThrow(/keywords/);
  });
});

describe('post-processing', () => {
  it('truncates at word boundaries', () => {
    expect(truncateAtWord('Aerial Orbit Around Kizhi Pogost, Russia', 30)).toBe(
      'Aerial Orbit Around Kizhi',
    );
    expect(truncateText('First sentence here. Second sentence is long.', 30)).toBe(
      'First sentence here.',
    );
  });

  it('cleans keywords: case, duplicates, plurals, technical terms, brands, characters', () => {
    expect(
      cleanKeywords(
        [
          'Church',
          'churches',
          'CHURCH',
          '4K',
          'DJI Mavic',
          'aerial',
          'cities',
          'city',
          'golden hour!',
          '1080p',
          '2024',
          'drone shot',
          '60fps',
        ],
        rules,
        50,
      ),
    ).toEqual(['church', 'aerial', 'cities', 'golden hour', 'drone shot']);
  });

  it('removes filler words and limits keywords', () => {
    const m = postprocessMetadata(
      {
        ...good,
        title: 'Stunning Aerial View of Kizhi',
        keywords: keywords(60),
        editorialReason: 'x',
      },
      limits,
      rules,
    );
    expect(m.title).toBe('Aerial View of Kizhi');
    expect(m.keywords).toHaveLength(49);
    expect(m.editorialReason).toBeNull();
  });
});
