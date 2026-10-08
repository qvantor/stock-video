import {
  DEFAULT_EXPORT_SETTINGS,
  type ExportSettings,
  type SegmentationManifest,
} from '@dfs/contracts';
import type { MediaInfo } from '@dfs/ffmpeg';
import type { Logger, VideoInput, VideoSource } from '../lib/types.js';

export const silentLog: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export const media = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  durationSec: 120,
  fps: 29.97,
  width: 3840,
  height: 2160,
  codec: 'hevc',
  pixFmt: 'yuv420p10le',
  bitDepth: 10,
  colorTransfer: 'rec709',
  hasAudio: false,
  creationTime: '2024-07-14T19:42:10.000000Z',
  location: { lat: 59.9386, lon: 30.3141, altitudeM: 120 },
  make: 'DJI',
  model: 'DJI Mini4 Pro',
  tags: {},
  djiMetaStream: null,
  ...over,
});

export const fakeVideos = (over: Partial<VideoInput> = {}): VideoSource => ({
  getVideo: async (id) => ({
    id,
    projectId: 'p1',
    originalFilename: 'DJI_0042.MP4',
    sourcePath: '/nonexistent/source.mp4',
    media: media(),
    manualLocation: null,
    ...over,
  }),
  getSharpness: async () => null,
  getTelemetry: async () => null,
});

export const manifest = (segments = 2): SegmentationManifest => ({
  manifestVersion: 1,
  projectId: 'p1',
  confirmedAt: '2024-07-15T10:00:00.000Z',
  settings: {
    minDuration: 7,
    maxDuration: 40,
    targetDuration: 25,
    analysisFps: 5,
    sensitivity: 1.5,
    includeStatic: false,
  },
  videos: [
    {
      videoId: 'v1',
      originalFilename: 'DJI_0042.MP4',
      sourcePath: '/nonexistent/source.mp4',
      durationSec: 120,
      fps: 29.97,
      width: 3840,
      height: 2160,
      segments: Array.from({ length: segments }, (_, i) => ({
        segmentId: `s${i}`,
        startSec: i * 30,
        endSec: i * 30 + 20,
        startFrame: Math.round(i * 30 * 29.97),
        endFrame: Math.round((i * 30 + 20) * 29.97),
        motionType: 'orbit_left' as const,
        score: 0.9,
        origin: 'ai' as const,
      })),
    },
  ],
});

export const settingsWith =
  (over: Partial<ExportSettings> = {}) =>
  (): ExportSettings => ({
    ...DEFAULT_EXPORT_SETTINGS,
    ...over,
  });
