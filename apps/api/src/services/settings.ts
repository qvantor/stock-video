import { eq } from 'drizzle-orm';
import { ExportSettingsSchema, type ExportSettings } from '@dfs/contracts';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { appSettings } from '../db/schema.js';

const EXPORT_KEY = 'export';

/** Global export settings, stored as JSON; missing fields fall back to defaults (and env overrides). */
export class SettingsService {
  private cached: ExportSettings | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: Pick<AppConfig, 'ollamaUrl' | 'ollamaModel'>,
  ) {}

  defaults(): ExportSettings {
    return ExportSettingsSchema.parse({
      ...(this.config.ollamaUrl ? { ollamaUrl: this.config.ollamaUrl } : {}),
      ...(this.config.ollamaModel ? { model: this.config.ollamaModel } : {}),
    });
  }

  getExport(): ExportSettings {
    if (this.cached) return this.cached;
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, EXPORT_KEY)).get();
    const stored = row?.value && typeof row.value === 'object' ? row.value : {};
    const parsed = ExportSettingsSchema.safeParse({ ...this.defaults(), ...stored });
    this.cached = parsed.success ? parsed.data : this.defaults();
    return this.cached;
  }

  putExport(next: ExportSettings): ExportSettings {
    const value = ExportSettingsSchema.parse(next);
    this.db
      .insert(appSettings)
      .values({ key: EXPORT_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();
    this.cached = value;
    return value;
  }
}
