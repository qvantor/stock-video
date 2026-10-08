import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_EXPORT_SETTINGS, type ClipMetadata, type TechContext } from '@dfs/contracts';
import { createAdapters, loadStockConfig } from '@dfs/stock-csv';
import { buildArchive, type ArchiveClip, type BuildArchiveInput } from './archive.js';
import type { ClipRecord } from './types.js';

const stock = loadStockConfig();
const tech: TechContext = {
  durationSec: 20,
  sourceDurationSec: 20,
  fps: 30,
  outputFps: 30,
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
  timeOfDay: 'day',
  season: 'summer',
  capturedAt: null,
  captureDate: '2024-07-14',
  altitudeM: null,
  droneModel: 'DJI Air 3',
};
const metadata = (over: Partial<ClipMetadata> = {}): ClipMetadata => ({
  title: 'Aerial Orbit Around Wooden Church, Kizhi, Russia',
  description: 'Drone orbits a wooden church on Kizhi island in summer.',
  keywords: ['wooden church', 'kizhi', 'russia', 'aerial', 'drone', 'orbit', 'island', 'summer'],
  subject: 'wooden church',
  placeConfidence: 'low',
  adobeCategory: 2,
  shutterstockCategories: ['Buildings/Landmarks'],
  envatoCategory: 'Buildings',
  recognizableBuildings: true,
  editorialSuggested: true,
  editorialReason: 'Protected heritage site',
  ...over,
});

describe('buildArchive', () => {
  let root: string;
  let input: BuildArchiveInput;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-archive-'));
    const clipDir = (j: string, c: string) => path.join(root, 'work', j, c);
    const clips: ArchiveClip[] = ['a', 'b'].map((id, i) => {
      const dir = clipDir('job', id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'cut.mov'), Buffer.alloc(1000, i));
      fs.writeFileSync(path.join(dir, 'frame_0.jpg'), 'jpeg');
      const record = {
        id,
        jobId: 'job',
        videoId: 'v',
        segmentId: `s${i}`,
        startSec: 0,
        endSec: 20,
        startFrame: 0,
        endFrame: 600,
        stepHashes: { cut: 'c', frames: 'f' },
        cutPath: path.join(dir, 'cut.mov'),
        outputSizeBytes: 1000,
        frames: [{ index: 0, timeSec: 6, sharpness: 1, url: '/x' }],
        metadata: metadata(),
        editorial: i === 0 ? null : false,
        geo: null,
        tech,
        generation: null,
        userHint: null,
        poiOverride: null,
      } as unknown as ClipRecord;
      return {
        record,
        filename: `wooden_church_orbit_20240714_00${i + 1}.mov`,
        originalFilename: 'DJI_0001.MP4',
      };
    });
    input = {
      projectName: 'Kizhi Trip',
      clips,
      excludedCount: 1,
      adapters: createAdapters(stock),
      settings: { ...DEFAULT_EXPORT_SETTINGS, adobeAuthor: 'jane' },
      exportsRoot: path.join(root, 'exports'),
      clipDir,
      now: new Date(2024, 7, 2, 10, 5),
      previous: null,
    };
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('writes the folder layout, CSVs, metadata.json, report.md and a ZIP', async () => {
    const r = await buildArchive(input);
    expect(path.basename(r.dir)).toBe('export_kizhi_trip_20240802_1005');
    const list = (sub: string) => fs.readdirSync(path.join(r.dir, sub)).sort();
    expect(list('videos')).toEqual([
      'wooden_church_orbit_20240714_001.mov',
      'wooden_church_orbit_20240714_002.mov',
    ]);
    expect(list('previews')).toEqual([
      'wooden_church_orbit_20240714_001_1.jpg',
      'wooden_church_orbit_20240714_002_1.jpg',
    ]);
    expect(list('csv')).toEqual([
      'adobe_stock_jane_2024_08_02.csv',
      'envato.csv',
      'pond5.csv',
      'shutterstock.csv',
    ]);
    const meta = JSON.parse(fs.readFileSync(path.join(r.dir, 'metadata.json'), 'utf8'));
    expect(meta.clips[0]).toMatchObject({
      filename: 'wooden_church_orbit_20240714_001.mov',
      final: { editorial: true },
    });
    expect(r.reportMd).toContain('Clips: 2 (excluded by the user: 1)');
    expect(r.reportMd).toContain('## Place confidence low or unknown');
    expect(r.reportMd).toContain('wooden_church_orbit_20240714_001.mov: editorial');
    expect(r.reportMd).toContain('commercial (model suggested editorial)');
    expect(fs.statSync(r.zip).size).toBeGreaterThan(2000);

    const unzip = spawnSync('unzip', ['-Z', '-v', r.zip]);
    if (unzip.status === 0) {
      const out = unzip.stdout.toString();
      expect(out).toContain(
        'export_kizhi_trip_20240802_1005/videos/wooden_church_orbit_20240714_001.mov',
      );
      expect(out).toMatch(/compression method:\s+none \(stored\)/);
      expect(out).toMatch(/compression method:\s+deflated/);
    }
  });

  it('reuses the previous archive when nothing changed and rebuilds after an edit', async () => {
    const first = await buildArchive(input);
    const again = await buildArchive({
      ...input,
      now: new Date(2024, 7, 3),
      previous: { hash: first.hash, dir: first.dir, zip: first.zip },
    });
    expect(again.reused).toBe(true);
    expect(again.dir).toBe(first.dir);

    const clip = input.clips[0] as ArchiveClip;
    const edited = {
      ...clip,
      record: { ...clip.record, metadata: metadata({ title: 'Edited Title' }) },
    };
    const rebuilt = await buildArchive({
      ...input,
      clips: [edited, ...input.clips.slice(1)],
      now: new Date(2024, 7, 3, 9, 0),
      previous: { hash: first.hash, dir: first.dir, zip: first.zip },
    });
    expect(rebuilt.reused).toBe(false);
    expect(fs.existsSync(first.dir)).toBe(false);
    expect(fs.readFileSync(path.join(rebuilt.dir, 'csv', 'shutterstock.csv'), 'utf8')).toContain(
      'Edited Title',
    );
  });
});
