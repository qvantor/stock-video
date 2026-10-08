import path from 'node:path';
import { ExportSettingsSchema } from '@dfs/contracts';
import { openDatabase, type DbHandle } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { SettingsService } from './settings.js';

const migrations = path.resolve(import.meta.dirname, '../../drizzle');
const noEnv = { ollamaUrl: null, ollamaModel: null };

describe('SettingsService', () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = openDatabase(':memory:', migrations);
  });
  afterEach(() => {
    handle.close();
  });

  const storeRaw = (value: unknown) =>
    handle.db.insert(appSettings).values({ key: 'export', value }).run();

  it('returns schema defaults when nothing is stored', () => {
    const settings = new SettingsService(handle.db, noEnv);
    expect(settings.getExport()).toEqual(ExportSettingsSchema.parse({}));
  });

  it('applies env overrides to the defaults', () => {
    const settings = new SettingsService(handle.db, {
      ollamaUrl: 'http://ollama:11434',
      ollamaModel: 'qwen2.5vl',
    });
    expect(settings.defaults()).toMatchObject({
      ollamaUrl: 'http://ollama:11434',
      model: 'qwen2.5vl',
    });
    expect(settings.getExport()).toMatchObject({
      ollamaUrl: 'http://ollama:11434',
      model: 'qwen2.5vl',
    });
  });

  it('merges a partial stored value over the defaults', () => {
    storeRaw({ model: 'llava', concurrency: 4 });
    const settings = new SettingsService(handle.db, {
      ollamaUrl: 'http://ollama:11434',
      ollamaModel: null,
    });

    expect(settings.getExport()).toEqual({
      ...ExportSettingsSchema.parse({}),
      ollamaUrl: 'http://ollama:11434',
      model: 'llava',
      concurrency: 4,
    });
  });

  it('falls back to the defaults when the stored value is invalid', () => {
    storeRaw({ concurrency: 999 });
    const settings = new SettingsService(handle.db, noEnv);
    expect(settings.getExport()).toEqual(settings.defaults());
  });

  it('ignores a stored value that is not an object', () => {
    storeRaw('garbage');
    const settings = new SettingsService(handle.db, noEnv);
    expect(settings.getExport()).toEqual(settings.defaults());
  });

  it('persists settings and upserts on repeated saves', () => {
    const settings = new SettingsService(handle.db, noEnv);
    const first = { ...settings.defaults(), model: 'a' };
    const second = { ...settings.defaults(), model: 'b', autoApprove: true };

    settings.putExport(first);
    expect(settings.putExport(second)).toEqual(second);

    // A fresh service reads from the DB, not the cache.
    expect(new SettingsService(handle.db, noEnv).getExport()).toEqual(second);
    expect(handle.db.select().from(appSettings).all()).toHaveLength(1);
  });

  it('rejects invalid settings on save', () => {
    const settings = new SettingsService(handle.db, noEnv);
    expect(() => settings.putExport({ ...settings.defaults(), concurrency: 0 })).toThrow();
    expect(settings.getExport()).toEqual(settings.defaults());
  });

  it('caches the value after the first read', () => {
    const settings = new SettingsService(handle.db, noEnv);
    const first = settings.getExport();
    storeRaw({ model: 'changed-behind-its-back' });
    expect(settings.getExport()).toBe(first);
  });
});
