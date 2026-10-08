import path from 'node:path';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    const dataDir = path.resolve('./data');
    expect(config).toEqual({
      dataDir,
      dataDirHost: dataDir,
      dbPath: path.join(dataDir, 'app.sqlite'),
      host: '0.0.0.0',
      port: 3333,
      queueConcurrency: 1,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      logLevel: 'info',
      ollamaUrl: null,
      ollamaModel: null,
    });
  });

  it('reads and coerces the environment', () => {
    const config = loadConfig({
      DATA_DIR: '/srv/data',
      DB_PATH: '/var/lib/app.sqlite',
      DATA_DIR_HOST: '/Users/me/footage',
      PORT: '8080',
      QUEUE_CONCURRENCY: '4',
      OLLAMA_URL: 'http://ollama:11434',
      OLLAMA_MODEL: 'qwen2.5vl',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({
      dataDir: '/srv/data',
      dataDirHost: '/Users/me/footage',
      dbPath: '/var/lib/app.sqlite',
      port: 8080,
      queueConcurrency: 4,
      ollamaUrl: 'http://ollama:11434',
      ollamaModel: 'qwen2.5vl',
      logLevel: 'debug',
    });
  });

  it.each([
    ['PORT', 'abc'],
    ['QUEUE_CONCURRENCY', '9'],
    ['OLLAMA_URL', 'not a url'],
    ['LOG_LEVEL', 'verbose'],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(/Invalid environment/);
  });
});
