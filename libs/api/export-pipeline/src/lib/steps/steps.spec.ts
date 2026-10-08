import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_EXPORT_SETTINGS } from '@dfs/contracts';
import { probeDetailed } from '@dfs/ffmpeg';
import { GeoService, MemoryGeoCache, type FetchFn } from '@dfs/geo';
import { framesStep, pickFrameTimes } from './frames.js';
import { geoStep, headingFromTrack } from './geo.js';
import { techStep } from './tech.js';
import { llmStep } from './llm.js';
import { loadPrompt, OllamaClient } from '@dfs/llm';
import { loadStockConfig } from '@dfs/stock-csv';
import type { StepDeps } from './deps.js';
import type { ClipRecord, StepContext, VideoInput } from '../types.js';
import { fakeVideos, media, silentLog } from '../../test/fixtures.js';
import { hasFfmpeg, makeClip, widthOf } from '../../test/ffmpeg.js';

const clip = (over: Partial<ClipRecord> = {}): ClipRecord => ({
  id: 'c1',
  jobId: 'j1',
  videoId: 'v1',
  segmentId: 's1',
  ordinal: 0,
  startSec: 10,
  endSec: 30,
  startFrame: 300,
  endFrame: 900,
  motionType: 'orbit_left',
  status: 'frames',
  progress: 0,
  failedStep: null,
  error: null,
  excluded: false,
  approved: false,
  frames: null,
  geo: null,
  tech: null,
  generation: null,
  metadata: null,
  editorial: null,
  userHint: null,
  poiOverride: null,
  stepHashes: {},
  cutPath: null,
  outputSizeBytes: null,
  filename: null,
  updatedAt: '',
  ...over,
});

const video = (over: Partial<VideoInput> = {}): VideoInput => ({
  id: 'v1',
  projectId: 'p1',
  originalFilename: 'DJI_0042.MP4',
  sourcePath: '/nonexistent.mp4',
  media: media(),
  manualLocation: null,
  ...over,
});

const ctx = (c: ClipRecord, v: VideoInput, settings = DEFAULT_EXPORT_SETTINGS): StepContext => ({
  clip: c,
  video: v,
  job: {} as StepContext['job'],
  settings,
  signal: new AbortController().signal,
  log: silentLog,
  onProgress: () => undefined,
});

describe('pickFrameTimes', () => {
  const series = {
    t: Array.from({ length: 200 }, (_, i) => i * 0.2),
    sharpness: Array.from({ length: 200 }, (_, i) => (i === 87 ? 900 : i === 112 ? 50 : 100)),
  };

  it('takes ~30% and ~70% and moves to the sharpest sample within ±1 s', () => {
    // 10..30 s → targets 16 s and 24 s; t=17.4 (i=87) is outside ±1 s of 16, so sharpness ties → first in window.
    const picks = pickFrameTimes(10, 30, series);
    expect(picks).toHaveLength(2);
    expect(picks[0]?.timeSec).toBeGreaterThanOrEqual(15);
    expect(picks[0]?.timeSec).toBeLessThanOrEqual(17);
    const sharp = pickFrameTimes(12, 32, series); // targets 18 and 26; i=87 (17.4 s) is within ±1 s of 18
    expect(sharp[0]).toEqual({ timeSec: 17.4, sharpness: 900 });
  });

  it('uses one frame from the middle for clips shorter than 15 s', () => {
    expect(pickFrameTimes(0, 10, null)).toEqual([{ timeSec: 5, sharpness: null }]);
  });

  it('falls back to the exact targets without stage-1 metrics', () => {
    expect(pickFrameTimes(0, 20, null).map((p) => p.timeSec)).toEqual([6, 14]);
  });
});

describe('geo step', () => {
  const calls: string[] = [];
  const fetchMock: FetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/search'))
      return new Response(JSON.stringify([{ lat: '61.7', lon: '35.2', display_name: 'Kizhi' }]));
    if (url.includes('/reverse'))
      return new Response(
        JSON.stringify({
          display_name: 'Kizhi, Karelia, Russia',
          name: url.includes('accept-language') ? 'Kizhi' : 'Кижи',
          address: {
            village: 'Kizhi',
            state: 'Republic of Karelia',
            country: 'Russia',
            country_code: 'ru',
          },
        }),
      );
    return new Response(JSON.stringify({ query: { pages: [] } }));
  };
  const deps = {
    geo: new GeoService({ cache: new MemoryGeoCache(), fetch: fetchMock }),
    videos: fakeVideos(),
  } as unknown as StepDeps;

  beforeEach(() => (calls.length = 0));

  it('prefers the manual location (geocoded) over embedded GPS', async () => {
    const { geo } = await geoStep(deps).run(
      ctx(clip(), video({ manualLocation: 'Kizhi, Russia' })),
    );
    expect(geo).toMatchObject({
      source: 'manual',
      lat: 61.7,
      city: 'Kizhi',
      localName: 'Кижи',
      country: 'Russia',
    });
    expect(calls[0]).toContain('/search');
  });

  it('uses embedded GPS when there is no manual location', async () => {
    const { geo } = await geoStep(deps).run(ctx(clip(), video()));
    expect(geo).toMatchObject({ source: 'embedded', lat: 59.9386, altitudeM: 120 });
  });

  it('uses the DJI telemetry track: clip midpoint and heading from the flight direction', async () => {
    const track = Array.from({ length: 41 }, (_, i) => ({
      t: i,
      lat: 42.5 + i * 0.0001,
      lon: 1.58,
      altitudeM: 1990,
    }));
    const telemetryDeps = {
      ...deps,
      videos: { ...fakeVideos(), getTelemetry: async () => track },
    } as unknown as StepDeps;
    const { geo } = await geoStep(telemetryDeps).run(
      ctx(
        clip({ startSec: 10, endSec: 30, motionType: 'forward' }),
        video({ media: media({ location: null }) }),
      ),
    );
    expect(geo).toMatchObject({
      source: 'embedded',
      lat: 42.502,
      lon: 1.58,
      altitudeM: 1990,
      cameraHeadingDeg: 0,
    });
  });

  it('heading only for forward/backward flights that actually moved', () => {
    const a = { t: 0, lat: 42.5, lon: 1.58, altitudeM: null };
    const b = { t: 10, lat: 42.5, lon: 1.581, altitudeM: null }; // ~82 m east
    expect(headingFromTrack(a, b, 'forward')).toBeCloseTo(90, 0);
    expect(headingFromTrack(a, b, 'backward')).toBeCloseTo(270, 0);
    expect(headingFromTrack(a, b, 'orbit_left')).toBeNull();
    expect(headingFromTrack(a, { ...a, t: 10 }, 'forward')).toBeNull();
  });

  it('reports an unknown place when nothing is available', async () => {
    const { geo } = await geoStep(deps).run(
      ctx(clip(), video({ media: media({ location: null }) })),
    );
    expect(geo).toMatchObject({ source: 'none', lat: null, city: null, poiCandidates: [] });
    expect(calls).toHaveLength(0);
  });

  it('hash changes when the manual location changes', () => {
    const step = geoStep(deps);
    expect(step.hash(ctx(clip(), video()))).not.toBe(
      step.hash(ctx(clip(), video({ manualLocation: 'Paris' }))),
    );
  });
});

describe('tech step', () => {
  it('uses the geo coordinates for light and season', async () => {
    const c = clip({
      geo: {
        source: 'embedded',
        lat: 59.9386,
        lon: 30.3141,
        altitudeM: 120,
        city: null,
        region: null,
        country: null,
        countryCode: null,
        displayName: null,
        localName: null,
        manualText: null,
        cameraHeadingDeg: null,
        poiCandidates: [],
      },
    });
    const { tech } = await techStep().run(ctx(c, video()));
    expect(tech).toMatchObject({
      season: 'summer',
      shotType: 'real_time',
      resolutionLabel: '4K',
      movement: ['Aerial', 'Drone', 'Arc'],
    });
  });
});

describe.skipIf(!hasFfmpeg())('frames step (ffmpeg)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-frames-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('extracts full-size and model frames, normalising 10-bit footage', async () => {
    const src = path.join(dir, 'src.mp4');
    makeClip(src, {
      seconds: 16,
      size: '1600x900',
      fps: 10,
      codec: 'libx265',
      pixFmt: 'yuv420p10le',
    });
    const info = await probeDetailed('ffprobe', src);
    expect(info.bitDepth).toBe(10);
    const deps = {
      ffmpegPath: 'ffmpeg',
      clipDir: (j: string, c: string) => path.join(dir, j, c),
      frameUrl: (c: string, i: number) => `/api/clips/${c}/frames/${i}`,
      videos: fakeVideos(),
    } as StepDeps;
    const step = framesStep(deps);
    const c = clip({ startSec: 0, endSec: 16 });
    const patch = await step.run(ctx(c, video({ sourcePath: src, media: info })));
    expect(patch.frames).toHaveLength(2);
    expect(widthOf(path.join(dir, 'j1', 'c1', 'frame_0.jpg'))).toBe(1600);
    expect(widthOf(path.join(dir, 'j1', 'c1', 'frame_0_llm.jpg'))).toBe(1280);
    expect(await step.isComplete({ ...c, frames: patch.frames ?? null })).toBe(true);
  }, 120_000);
});

describe('llm step', () => {
  const stock = loadStockConfig();
  const answer = {
    title: 'Aerial Orbit Around Wooden Church on Kizhi Island, Russia',
    description:
      'Drone orbits a wooden church on an island in Lake Onega at golden hour in summer.',
    keywords: Array.from({ length: 40 }, (_, i) => `keyword${i}`),
    subject: 'wooden church',
    placeConfidence: 'medium',
    adobeCategory: 2,
    shutterstockCategories: ['Buildings/Landmarks'],
    envatoCategory: 'Buildings',
    recognizableBuildings: true,
    editorialSuggested: false,
    editorialReason: null,
  };
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-llm-step-'));
    fs.mkdirSync(path.join(dir, 'j1', 'c1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'j1', 'c1', 'frame_0_llm.jpg'), Buffer.from('fake-jpeg'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const deps = (models: string[]) => {
    const sent: { images?: string[] }[][] = [];
    const ollama = () =>
      new OllamaClient({
        baseUrl: 'http://ollama',
        fetch: async (url, init) => {
          if (url.endsWith('/api/tags'))
            return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }));
          sent.push(JSON.parse(String(init?.body)).messages);
          return new Response(
            JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(answer) } }),
          );
        },
      });
    return {
      sent,
      deps: {
        clipDir: (j: string, c: string) => path.join(dir, j, c),
        stock,
        prompt: loadPrompt(),
        ollama,
        llmLogDir: path.join(dir, 'logs'),
      } as unknown as StepDeps,
    };
  };

  const ready = () =>
    clip({
      frames: [{ index: 0, timeSec: 15, sharpness: 1, url: '/x' }],
      tech: {
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
        timeOfDay: null,
        season: null,
        capturedAt: null,
        captureDate: null,
        altitudeM: null,
        droneModel: null,
      },
    });

  it('sends the model frame and stores metadata with the prompt version', async () => {
    const { deps: d, sent } = deps(['gemma4:31b']);
    const patch = await llmStep(d).run(ctx(ready(), video()));
    expect(patch.metadata?.subject).toBe('wooden church');
    expect(patch.generation).toMatchObject({
      model: 'gemma4:31b',
      promptVersion: 'metadata.v1',
      attempts: 1,
    });
    expect(sent[0]?.[1]?.images).toEqual([Buffer.from('fake-jpeg').toString('base64')]);
    expect(fs.readdirSync(path.join(dir, 'logs')).length).toBeGreaterThan(0);
  });

  it('fails with a pull command when the model is missing', async () => {
    const { deps: d } = deps(['llava:7b']);
    await expect(llmStep(d).run(ctx(ready(), video()))).rejects.toThrow('ollama pull gemma4:31b');
  });

  it('hash changes with the user hint and chosen landmark', () => {
    const { deps: d } = deps([]);
    const step = llmStep(d);
    const base = ready();
    expect(step.hash(ctx(base, video()))).not.toBe(
      step.hash(ctx({ ...base, userHint: 'Kazan Cathedral' }, video())),
    );
    expect(step.hash(ctx(base, video()))).not.toBe(
      step.hash(ctx({ ...base, poiOverride: 'Kizhi Pogost' }, video())),
    );
  });
});
