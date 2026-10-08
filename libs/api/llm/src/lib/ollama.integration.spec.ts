import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TechContext } from '@dfs/contracts';
import { loadStockConfig, stockCategories } from '@dfs/stock-csv';
import { generateMetadata } from './generate.js';
import { OllamaClient } from './ollama.js';
import { loadPrompt } from './prompt.js';

/**
 * Opt-in test against a real local Ollama:
 *   OLLAMA_IT=1 [OLLAMA_URL=…] [OLLAMA_MODEL=gemma4:31b] [OLLAMA_IT_IMAGE=frame.jpg] pnpm nx test llm
 */
const url = process.env['OLLAMA_URL'] ?? 'http://localhost:11434';
const model = process.env['OLLAMA_MODEL'] ?? 'gemma4:31b';

describe.skipIf(!process.env['OLLAMA_IT'])('real Ollama', () => {
  it('generates valid metadata for a frame', async () => {
    const stock = loadStockConfig();
    const client = new OllamaClient({ baseUrl: url });
    const health = await client.health(model);
    expect(health.message).toBeNull();

    let image = process.env['OLLAMA_IT_IMAGE'];
    if (!image) {
      image = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-it-')), 'frame.jpg');
      // prettier-ignore
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-frames:v', '1', image]);
    }
    const tech: TechContext = {
      durationSec: 20,
      sourceDurationSec: 20,
      fps: 30,
      outputFps: 30,
      width: 3840,
      height: 2160,
      resolutionLabel: '4K',
      codec: 'hevc',
      bitDepth: 8,
      colorTransfer: 'rec709',
      hasAudio: false,
      shotType: 'real_time',
      motionType: 'forward',
      movement: ['Aerial', 'Drone'],
      timeOfDay: 'day',
      season: 'summer',
      capturedAt: null,
      captureDate: '2024-07-14',
      altitudeM: null,
      droneModel: null,
    };
    const result = await generateMetadata(
      {
        clipId: 'integration',
        images: [fs.readFileSync(image).toString('base64')],
        geo: null,
        tech,
        hint: null,
        poiName: null,
        categories: stockCategories(stock),
      },
      {
        client,
        model,
        think: false,
        keepAlive: '10m',
        temperature: 0.3,
        timeoutMs: 600_000,
        prompt: loadPrompt(),
        limits: stock.common.llm,
        rules: stock.common,
        logDir: path.join(os.tmpdir(), 'dfs-llm-logs'),
      },
    );
    console.log(JSON.stringify(result, null, 2));
    expect(result.metadata.keywords.length).toBeGreaterThanOrEqual(5);
    expect(result.metadata.title.length).toBeLessThanOrEqual(70);
  }, 900_000);
});
