import fs from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { SystemCheck, SystemStatus } from '@dfs/contracts';
import { checkBinaries } from '@dfs/ffmpeg';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { ExportService } from './export.js';
import type { SettingsService } from './settings.js';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const CHECK_TIMEOUT_MS = 5000;
/** Nominatim's usage policy asks to keep requests to a minimum, so its status is cached. */
const GEOCODER_CACHE_MS = 5 * 60_000;
const MIN_FREE_BYTES = 1024 ** 3;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

interface StatusDeps {
  config: Pick<AppConfig, 'dataDir' | 'ffmpegPath' | 'ffprobePath'>;
  db: Db;
  settings: SettingsService;
  exports: ExportService;
  fetch?: FetchFn;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms).unref(),
    ),
  ]);

const formatGb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Health of every system the app depends on, for the status indicator. */
export class StatusService {
  private readonly fetch: FetchFn;
  private geocoderCache: { at: number; result: Omit<SystemCheck, 'id' | 'label'> } | null = null;

  constructor(private readonly d: StatusDeps) {
    this.fetch = d.fetch ?? ((url, init) => fetch(url, init));
  }

  async check(): Promise<SystemStatus> {
    const { model } = this.d.settings.getExport();
    const checks = await Promise.all([
      this.run('database', 'Database', () => this.database()),
      this.run('storage', 'Storage', () => this.storage()),
      this.run('ffmpeg', 'ffmpeg / ffprobe', () => this.ffmpeg()),
      this.run('ollama', `LLM (Ollama, ${model})`, () => this.ollama()),
      this.run('geocoder', 'Geocoder (Nominatim)', () => this.geocoder()),
    ]);
    return { checks };
  }

  private async run(
    id: string,
    label: string,
    fn: () => Promise<string | null>,
  ): Promise<SystemCheck> {
    try {
      const message = await withTimeout(fn(), CHECK_TIMEOUT_MS);
      return { id, label, ok: true, message };
    } catch (err) {
      return { id, label, ok: false, message: (err as Error).message };
    }
  }

  private async database(): Promise<null> {
    this.d.db.run(sql`select 1`);
    return null;
  }

  private async storage(): Promise<string> {
    const dir = this.d.config.dataDir;
    try {
      await fs.access(dir, fs.constants.W_OK);
    } catch {
      throw new Error(`Data directory ${dir} is not writable`);
    }
    const stats = await fs.statfs(dir);
    const free = stats.bavail * stats.bsize;
    if (free < MIN_FREE_BYTES) throw new Error(`Low disk space: ${formatGb(free)} free in ${dir}`);
    return `${formatGb(free)} free`;
  }

  private async ffmpeg(): Promise<string | null> {
    const versions = await checkBinaries(this.d.config);
    // "ffmpeg version 6.1 Copyright (c) ..." -> "ffmpeg version 6.1"
    return versions[0]?.replace(/\s+Copyright.*$/, '') || null;
  }

  private async ollama(): Promise<null> {
    const health = await this.d.exports.health();
    if (!health.ok) throw new Error(health.message ?? 'Ollama is not ready');
    return null;
  }

  private async geocoder(): Promise<string | null> {
    const cached = this.geocoderCache;
    if (!cached || Date.now() - cached.at > GEOCODER_CACHE_MS) {
      this.geocoderCache = { at: Date.now(), result: await this.fetchGeocoderStatus() };
    }
    const { ok, message } = this.geocoderCache!.result;
    if (!ok) throw new Error(message ?? 'Nominatim is not available');
    return message;
  }

  private async fetchGeocoderStatus(): Promise<Omit<SystemCheck, 'id' | 'label'>> {
    const { nominatimUserAgent } = this.d.settings.getExport();
    try {
      const res = await this.fetch(`${NOMINATIM_URL}/status?format=json`, {
        headers: { 'user-agent': nominatimUserAgent, accept: 'application/json' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, message: `Nominatim responded with HTTP ${res.status}` };
      const body = (await res.json()) as { status?: number; message?: string };
      return body.status === 0
        ? { ok: true, message: null }
        : { ok: false, message: `Nominatim reports: ${body.message ?? 'unknown error'}` };
    } catch (err) {
      return { ok: false, message: `Nominatim is not reachable (${(err as Error).message})` };
    }
  }
}
